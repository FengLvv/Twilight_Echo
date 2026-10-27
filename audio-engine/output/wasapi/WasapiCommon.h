#pragma once

#include "../../core/AudioTypes.h"
#include "../IOutputBackend.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

// writeSilentPcm / leading-silence helpers below need AudioSampleFormat.

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <audioclient.h>
#include <ksmedia.h>
#include <mmreg.h>
#endif

namespace twilight::audio::wasapi {

#if defined(_WIN32) && defined(TAE_ENABLE_WASAPI)

class ComApartment final {
 public:
  ComApartment() {
    hr_ = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (hr_ == RPC_E_CHANGED_MODE) {
      hr_ = S_OK;
      initialized_ = false;
    } else {
      initialized_ = SUCCEEDED(hr_);
    }
  }

  ~ComApartment() {
    if (initialized_) CoUninitialize();
  }

  ComApartment(const ComApartment&) = delete;
  ComApartment& operator=(const ComApartment&) = delete;

  HRESULT result() const { return hr_; }

 private:
  HRESULT hr_ = E_FAIL;
  bool initialized_ = false;
};

class UniqueHandle final {
 public:
  UniqueHandle() = default;
  explicit UniqueHandle(HANDLE handle) : handle_(handle) {}

  ~UniqueHandle() { reset(); }

  UniqueHandle(const UniqueHandle&) = delete;
  UniqueHandle& operator=(const UniqueHandle&) = delete;

  UniqueHandle(UniqueHandle&& other) noexcept : handle_(other.release()) {}

  UniqueHandle& operator=(UniqueHandle&& other) noexcept {
    if (this != &other) reset(other.release());
    return *this;
  }

  HANDLE get() const { return handle_; }
  explicit operator bool() const { return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE; }

  HANDLE release() {
    HANDLE out = handle_;
    handle_ = nullptr;
    return out;
  }

  void reset(HANDLE handle = nullptr) {
    if (handle_ && handle_ != INVALID_HANDLE_VALUE) CloseHandle(handle_);
    handle_ = handle;
  }

 private:
  HANDLE handle_ = nullptr;
};

inline std::wstring utf8ToWide(const std::string& value) {
  if (value.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
  if (size <= 0) return {};
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, wide.data(), size);
  if (!wide.empty() && wide.back() == L'\0') wide.pop_back();
  return wide;
}

inline std::string wideToUtf8(const wchar_t* value) {
  if (!value) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value, -1, out.data(), size, nullptr, nullptr);
  if (!out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

inline bool succeeded(HRESULT hr, std::string* error, const char* message) {
  if (SUCCEEDED(hr)) return true;
  if (error) {
    char buffer[160] = {};
    std::snprintf(buffer, sizeof(buffer), "%s (错误码 0x%08lx)", message, static_cast<unsigned long>(hr));
    *error = buffer;
  }
  return false;
}

inline bool isDeviceInvalidated(HRESULT hr) {
  return hr == AUDCLNT_E_DEVICE_INVALIDATED || hr == AUDCLNT_E_RESOURCES_INVALIDATED ||
         hr == AUDCLNT_E_SERVICE_NOT_RUNNING;
}

inline bool isDeviceInUse(HRESULT hr) {
  return hr == AUDCLNT_E_DEVICE_IN_USE;
}

inline constexpr int kExclusiveDeviceInUseRetryDelaysMs[] = {25, 50, 75, 100, 150, 200};

inline bool shouldRetryExclusiveInitWithDefaultPeriod(
    HRESULT hr,
    REFERENCE_TIME requestedDuration,
    REFERENCE_TIME defaultPeriod) {
  if (defaultPeriod <= requestedDuration) return false;
  if (isDeviceInUse(hr) || isDeviceInvalidated(hr)) return false;
  if (hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED || hr == AUDCLNT_E_ENDPOINT_CREATE_FAILED) {
    return false;
  }
  return true;
}

struct ExclusiveEndpointHolder {
  uint32_t pid = 0;
  std::string processName;
  bool isSelfExecutable = false;
  bool isZombieProcess = false;
};

struct ExclusiveInitFailureClassification {
  const char* reasonCode = "backend_open_failure";
  std::string message;
};

inline ExclusiveInitFailureClassification describeExclusiveInitFailure(
    HRESULT hr,
    const std::string& formatSummary,
    const std::vector<ExclusiveEndpointHolder>& holders = {}) {
  if (isDeviceInUse(hr)) {
    for (const auto& holder : holders) {
      if (holder.isSelfExecutable && holder.isZombieProcess) {
        return {
            "device_in_use",
            "WASAPI 独占初始化失败：音频设备被未退出的旧 TwilightEcho 进程 (PID " +
                std::to_string(holder.pid) +
                ") 持续占用（USB 音频驱动可能卡死，请尝试重新插拔 DAC 或重启电脑）",
        };
      }
    }
    for (const auto& holder : holders) {
      if (holder.isSelfExecutable) {
        return {
            "device_in_use",
            "WASAPI 独占初始化失败：音频设备正被旧 TwilightEcho 音频进程 (PID " +
                std::to_string(holder.pid) + ") 占用",
        };
      }
    }
    if (!holders.empty()) {
      std::string holderText;
      for (size_t i = 0; i < holders.size(); ++i) {
        if (i > 0) holderText += ", ";
        holderText += holders[i].processName.empty() ? "未知进程" : holders[i].processName;
        if (holders[i].pid != 0) {
          holderText += " (PID " + std::to_string(holders[i].pid) + ")";
        }
      }
      return {
          "device_in_use",
          "WASAPI 独占初始化失败：音频设备正被其他程序占用（" + holderText + "）",
      };
    }
    return {
        "device_in_use",
        "WASAPI 独占初始化失败：音频设备正被其他程序或驱动占用",
    };
  }
  if (hr == AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED) {
    return {
        "exclusive_not_allowed",
        "WASAPI 独占初始化失败：系统或设备未允许独占模式（请检查系统声音设置中的独占模式选项）",
    };
  }
  if (isDeviceInvalidated(hr)) {
    return {
        "device_invalidated",
        "WASAPI 独占初始化失败：音频设备已断开或系统音频服务未运行",
    };
  }
  if (hr == AUDCLNT_E_ENDPOINT_CREATE_FAILED) {
    return {
        "endpoint_create_failed",
        "WASAPI 独占初始化失败：无法创建硬件音频端点（驱动可能未就绪或仍处于占用状态）",
    };
  }
  if (hr == AUDCLNT_E_CPUUSAGE_EXCEEDED) {
    return {
        "backend_open_failure",
        "WASAPI 独占初始化失败：音频引擎保护时长或 CPU 占用超限",
    };
  }
  if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED || hr == AUDCLNT_E_BUFFER_SIZE_ERROR ||
      hr == AUDCLNT_E_INVALID_DEVICE_PERIOD) {
    return {
        "backend_open_failure",
        "WASAPI 独占初始化失败：设备拒绝请求的缓冲周期或缓冲区大小",
    };
  }
  return {
      "backend_open_failure",
      "WASAPI 独占 init failure：设备拒绝协商格式 " + formatSummary,
  };
}

inline bool isDefaultDeviceAlias(const std::string& deviceId) {
  return deviceId.empty() || deviceId == "auto" || deviceId == "default" || deviceId == "System Default" ||
         deviceId == "system default" || deviceId == "system-default" || deviceId == "系统默认";
}

inline DWORD defaultChannelMask(int channelCount) {
  switch (channelCount) {
    case 1:
      return SPEAKER_FRONT_CENTER;
    case 2:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    case 4:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 6:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY |
             SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT;
    case 8:
      return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY |
             SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT | SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT;
    default:
      return 0;
  }
}

inline REFERENCE_TIME framesToReferenceTime(UINT32 frames, int sampleRate) {
  if (frames == 0 || sampleRate <= 0) return 0;
  return static_cast<REFERENCE_TIME>(
      (static_cast<long double>(frames) * 10000000.0L / static_cast<long double>(sampleRate)) + 0.5L);
}

inline REFERENCE_TIME chooseExclusiveBufferDuration(
    UINT32 preferredBufferSize,
    int sampleRate,
    REFERENCE_TIME defaultPeriod,
    REFERENCE_TIME minimumPeriod) {
  if (preferredBufferSize > 0) return framesToReferenceTime(preferredBufferSize, sampleRate);
  if (defaultPeriod > 0) return defaultPeriod;
  if (minimumPeriod > 0) return minimumPeriod;
  return std::max<REFERENCE_TIME>(1, framesToReferenceTime(256, sampleRate));
}

inline UINT32 exclusiveInitialRenderFrames(UINT32 bufferFrameCount, bool pushMode) {
  if (bufferFrameCount == 0) return 0;
  if (!pushMode) return bufferFrameCount;
  return std::max<UINT32>(1, bufferFrameCount / 2);
}

inline UINT32 exclusiveRenderFrames(UINT32 bufferFrameCount, UINT32 padding, bool pushMode) {
  if (bufferFrameCount == 0) return 0;
  if (!pushMode) return bufferFrameCount;
  return bufferFrameCount > padding ? bufferFrameCount - padding : 0;
}

inline size_t renderFloatCallbackWithTailSilence(
    float* output,
    size_t frameCount,
    int channelCount,
    const RenderCallback& callback) {
  if (!output || frameCount == 0 || channelCount <= 0) return 0;

  size_t renderedFrames = 0;
  if (callback) {
    renderedFrames = std::min(callback(output, frameCount), frameCount);
  }

  if (renderedFrames < frameCount) {
    const size_t renderedSamples = renderedFrames * static_cast<size_t>(channelCount);
    const size_t totalSamples = frameCount * static_cast<size_t>(channelCount);
    std::fill(output + renderedSamples, output + totalSamples, 0.0f);
  }
  return renderedFrames;
}

// Soft-start helper: silence the first buffer period on device open so Start() does not
// attack at full level after a hard rebind (device switch / default follow).
inline size_t renderFloatCallbackWithLeadingSilence(
    float* output,
    size_t frameCount,
    int channelCount,
    const RenderCallback& callback,
    size_t silentLeadFrames) {
  if (!output || frameCount == 0 || channelCount <= 0) return 0;

  const size_t lead = std::min(silentLeadFrames, frameCount);
  if (lead > 0) {
    std::fill(output, output + lead * static_cast<size_t>(channelCount), 0.0f);
  }
  if (lead >= frameCount) {
    // Still advance the decoder so seek position stays aligned with wall clock.
    if (callback && frameCount > 0) {
      std::vector<float> discard(frameCount * static_cast<size_t>(channelCount));
      (void)callback(discard.data(), frameCount);
    }
    return 0;
  }

  float* tail = output + lead * static_cast<size_t>(channelCount);
  const size_t remaining = frameCount - lead;
  size_t renderedFrames = 0;
  if (callback) {
    renderedFrames = std::min(callback(tail, remaining), remaining);
  }
  if (renderedFrames < remaining) {
    const size_t renderedSamples = renderedFrames * static_cast<size_t>(channelCount);
    const size_t totalSamples = remaining * static_cast<size_t>(channelCount);
    std::fill(tail + renderedSamples, tail + totalSamples, 0.0f);
  }
  return lead + renderedFrames;
}

inline void writeSilentPcm(
    BYTE* output,
    size_t frameCount,
    int channelCount,
    AudioSampleFormat sampleFormat) {
  if (!output || frameCount == 0 || channelCount <= 0) return;
  size_t bytesPerSample = 4;
  switch (sampleFormat) {
    case AudioSampleFormat::Int16Interleaved:
      bytesPerSample = 2;
      break;
    case AudioSampleFormat::Int24Interleaved:
      bytesPerSample = 3;
      break;
    case AudioSampleFormat::Int24In32Interleaved:
    case AudioSampleFormat::Int32Interleaved:
    case AudioSampleFormat::Float32Interleaved:
    default:
      bytesPerSample = 4;
      break;
  }
  std::memset(
      output,
      0,
      frameCount * static_cast<size_t>(channelCount) * bytesPerSample);
}

inline UINT32 referenceTimeToFrames(REFERENCE_TIME duration, int sampleRate) {
  if (duration <= 0 || sampleRate <= 0) return 0;
  return static_cast<UINT32>(
      (static_cast<long double>(duration) * static_cast<long double>(sampleRate) / 10000000.0L) + 0.5L);
}

inline int32_t floatToSignedInt(float sample, int bits) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  if (bits == 16) {
    return static_cast<int32_t>(std::clamp(
        std::llround(clamped * 32768.0),
        static_cast<long long>(std::numeric_limits<int16_t>::min()),
        static_cast<long long>(std::numeric_limits<int16_t>::max())));
  }
  if (bits == 24) {
    return static_cast<int32_t>(std::clamp(
        std::llround(clamped * 8388608.0),
        -8388608LL,
        8388607LL));
  }
  const long long value = std::clamp(
      std::llround(clamped * 2147483648.0),
      static_cast<long long>(std::numeric_limits<int32_t>::min()),
      static_cast<long long>(std::numeric_limits<int32_t>::max()));
  return static_cast<int32_t>(value);
}

inline int16_t floatToSignedInt16(float sample) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  return static_cast<int16_t>(std::clamp(
      std::llround(clamped * 32768.0),
      static_cast<long long>(std::numeric_limits<int16_t>::min()),
      static_cast<long long>(std::numeric_limits<int16_t>::max())));
}

inline int32_t floatToSignedInt24(float sample) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  return static_cast<int32_t>(std::clamp(std::llround(clamped * 8388608.0), -8388608LL, 8388607LL));
}

inline int32_t floatToSignedInt32(float sample) {
  const double clamped = std::clamp(static_cast<double>(sample), -1.0, 1.0);
  const long long value = std::clamp(
      std::llround(clamped * 2147483648.0),
      static_cast<long long>(std::numeric_limits<int32_t>::min()),
      static_cast<long long>(std::numeric_limits<int32_t>::max()));
  return static_cast<int32_t>(value);
}

inline void packFloatToInt16(const float* input, size_t sampleCount, int16_t* output) {
  if (!input || !output || sampleCount == 0) return;
  for (size_t i = 0; i < sampleCount; ++i) {
    output[i] = floatToSignedInt16(input[i]);
  }
}

inline void packFloatToPackedInt24(const float* input, size_t sampleCount, BYTE* output) {
  if (!input || !output || sampleCount == 0) return;
  for (size_t i = 0; i < sampleCount; ++i) {
    const auto value = static_cast<uint32_t>(floatToSignedInt24(input[i]));
    output[i * 3 + 0] = static_cast<BYTE>(value & 0xff);
    output[i * 3 + 1] = static_cast<BYTE>((value >> 8) & 0xff);
    output[i * 3 + 2] = static_cast<BYTE>((value >> 16) & 0xff);
  }
}

inline void packFloatToInt32(const float* input, size_t sampleCount, int32_t* output) {
  if (!input || !output || sampleCount == 0) return;
  for (size_t i = 0; i < sampleCount; ++i) {
    output[i] = floatToSignedInt32(input[i]);
  }
}

inline void packFloatToPcm(
    const float* input,
    size_t frameCount,
    int channelCount,
    AudioSampleFormat sampleFormat,
    BYTE* output) {
  if (!input || !output || frameCount == 0 || channelCount <= 0) return;

  const size_t sampleCount = frameCount * static_cast<size_t>(channelCount);
  switch (sampleFormat) {
    case AudioSampleFormat::Int16Interleaved: {
      auto* out = reinterpret_cast<int16_t*>(output);
      packFloatToInt16(input, sampleCount, out);
      break;
    }
    case AudioSampleFormat::Int24Interleaved: {
      packFloatToPackedInt24(input, sampleCount, output);
      break;
    }
    case AudioSampleFormat::Int24In32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      for (size_t i = 0; i < sampleCount; ++i) {
        out[i] = static_cast<int32_t>(static_cast<uint32_t>(floatToSignedInt24(input[i])) << 8);
      }
      break;
    }
    case AudioSampleFormat::Int32Interleaved: {
      auto* out = reinterpret_cast<int32_t*>(output);
      packFloatToInt32(input, sampleCount, out);
      break;
    }
    case AudioSampleFormat::Float32Interleaved:
      std::memcpy(output, input, sampleCount * sizeof(float));
      break;
    default:
      std::fill(output, output + sampleCount * sizeof(float), 0);
      break;
  }
}

#endif

}  // namespace twilight::audio::wasapi
