#pragma once

#include "../../core/AudioTypes.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace twilight::audio {

using CoreAudioDeviceID = uint32_t;
using CoreAudioAudioUnit = std::uintptr_t;
using CoreAudioOSStatus = int32_t;
using CoreAudioListenerToken = std::uint64_t;

struct CoreAudioStreamBasicDescription {
  double sampleRate = 0.0;
  uint32_t formatID = 0;
  uint32_t formatFlags = 0;
  uint32_t bytesPerPacket = 0;
  uint32_t framesPerPacket = 0;
  uint32_t bytesPerFrame = 0;
  uint32_t channelsPerFrame = 0;
  uint32_t bitsPerChannel = 0;
};

struct CoreAudioBuffer {
  uint32_t numberChannels = 0;
  uint32_t dataByteSize = 0;
  uint8_t* externalData = nullptr;
  std::vector<uint8_t> data;

  size_t byteSize() const {
    return externalData ? static_cast<size_t>(dataByteSize) : data.size();
  }

  uint8_t* writableData() {
    return externalData ? externalData : data.data();
  }

  const uint8_t* readableData() const {
    return externalData ? externalData : data.data();
  }

  bool hasData() const {
    return byteSize() > 0 && readableData() != nullptr;
  }

  void bindExternal(uint8_t* bytes, uint32_t size) {
    externalData = bytes;
    dataByteSize = size;
  }
};

struct CoreAudioBufferList {
  std::vector<CoreAudioBuffer> buffers;
  bool usesActiveBufferCount = false;
  size_t activeBufferCount = 0;

  size_t bufferCount() const {
    return usesActiveBufferCount ? std::min(activeBufferCount, buffers.size()) : buffers.size();
  }

  CoreAudioBuffer& bufferAt(size_t index) {
    return buffers[index];
  }

  const CoreAudioBuffer& bufferAt(size_t index) const {
    return buffers[index];
  }

  void setActiveBufferCount(size_t count) {
    usesActiveBufferCount = true;
    activeBufferCount = count;
  }
};

using CoreAudioRenderCallback = std::function<size_t(uint32_t frameCount, CoreAudioBufferList& ioData)>;
using CoreAudioDeviceLostCallback = std::function<void(const std::string& message)>;

class ICoreAudioHost {
 public:
  virtual ~ICoreAudioHost() = default;

  virtual bool findOutputDevice(const std::string& requestedDeviceId, CoreAudioDeviceID* outDeviceId, std::string* error) = 0;
  virtual std::string deviceName(CoreAudioDeviceID deviceId) = 0;
  virtual std::string deviceUid(CoreAudioDeviceID deviceId) {
    (void)deviceId;
    return {};
  }
  virtual int outputChannelCount(CoreAudioDeviceID deviceId) = 0;
  virtual double getNominalSampleRate(CoreAudioDeviceID deviceId) = 0;
  virtual bool setNominalSampleRate(CoreAudioDeviceID deviceId, double rate, std::string* error) = 0;
  virtual bool supportsNominalSampleRate(CoreAudioDeviceID deviceId, double rate) = 0;
  virtual std::vector<double> availableNominalSampleRates(CoreAudioDeviceID deviceId) = 0;
  virtual bool deviceOutputStreamFormat(
      CoreAudioDeviceID deviceId,
      CoreAudioStreamBasicDescription* out,
      std::string* error) = 0;
  virtual bool hogModeOwnerPid(CoreAudioDeviceID deviceId, int32_t* ownerPid, std::string* error) = 0;
  virtual bool acquireHogMode(CoreAudioDeviceID deviceId, int32_t* existingOwnerPid, std::string* error) = 0;
  virtual void releaseHogMode(CoreAudioDeviceID deviceId) = 0;

  virtual bool findHalOutputUnit(std::string* error) = 0;
  virtual bool newAudioUnit(CoreAudioAudioUnit* outUnit, std::string* error) = 0;
  virtual bool enableIOBus(CoreAudioAudioUnit unit, bool input, bool enable, std::string* error) = 0;
  virtual bool bindDevice(CoreAudioAudioUnit unit, CoreAudioDeviceID deviceId, std::string* error) = 0;
  virtual bool applyBufferSize(CoreAudioDeviceID deviceId, uint32_t preferredBufferSize, std::string* error) = 0;
  virtual uint32_t currentBufferFrameSize(CoreAudioDeviceID deviceId) = 0;
  virtual uint32_t estimatedOutputLatencyFrames(CoreAudioDeviceID deviceId) = 0;
  virtual bool setStreamFormat(
      CoreAudioAudioUnit unit,
      bool input,
      const CoreAudioStreamBasicDescription& format,
      std::string* error) = 0;
  virtual bool setRenderCallback(CoreAudioAudioUnit unit, CoreAudioRenderCallback callback, std::string* error) = 0;
  virtual bool audioUnitInitialize(CoreAudioAudioUnit unit, std::string* error) = 0;
  virtual bool audioUnitStart(CoreAudioAudioUnit unit, std::string* error) = 0;
  virtual void audioUnitStop(CoreAudioAudioUnit unit) = 0;
  virtual void audioUnitUninitialize(CoreAudioAudioUnit unit) = 0;
  virtual void disposeAudioUnit(CoreAudioAudioUnit unit) = 0;

  virtual CoreAudioListenerToken addDeviceLostListener(
      CoreAudioDeviceID deviceId,
      CoreAudioDeviceLostCallback callback,
      std::string* error) = 0;
  virtual void removeDeviceLostListener(CoreAudioDeviceID deviceId, CoreAudioListenerToken token) = 0;
};

#if defined(__APPLE__) && defined(TAE_ENABLE_COREAUDIO)
std::unique_ptr<ICoreAudioHost> createRealCoreAudioHost();
#else
inline std::unique_ptr<ICoreAudioHost> createRealCoreAudioHost() {
  return {};
}
#endif

}  // namespace twilight::audio
