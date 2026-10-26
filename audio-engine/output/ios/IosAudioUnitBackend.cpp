#include "IosAudioUnitBackend.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstring>
#include <mutex>
#include <thread>
#include <utility>
#include <vector>

namespace twilight::audio {
namespace {

constexpr int kDefaultIosSampleRate = 48000;
constexpr int kDefaultIosChannels = 2;
constexpr int kDefaultIosBufferFrames = 512;

double framesToLatencyMs(int frames, int sampleRate) {
  return sampleRate > 0 ? static_cast<double>(frames) * 1000.0 / static_cast<double>(sampleRate) : 0.0;
}

}  // namespace

struct IosAudioUnitBackend::Impl {
  mutable std::mutex mutex;
  RenderCallback callback;
  OutputEventCallback eventCallback;
  OutputConfig outputConfig;
  AudioFormat format;
  OutputInfo info;
  DopRuntimeFacts dopFacts;
  std::string currentDeviceId = "auto";
  std::string currentDeviceName = "iOS RemoteIO AudioUnit Output";
  std::atomic<bool> opened{false};
  std::atomic<bool> running{false};
  std::atomic<bool> stopRequested{false};
  int latencyFrames = kDefaultIosBufferFrames;
  std::thread renderThread;
  std::vector<float> renderScratch;

  void resetStateLocked() {
    format = {};
    info = {};
    dopFacts = {};
    currentDeviceId = "auto";
    currentDeviceName = "iOS RemoteIO AudioUnit Output";
    latencyFrames = kDefaultIosBufferFrames;
    renderScratch.clear();
  }

  void renderLoop() {
    RenderCallback localCallback;
    int channels = kDefaultIosChannels;
    int sampleRate = kDefaultIosSampleRate;
    int periodFrames = kDefaultIosBufferFrames;
    {
      std::lock_guard lock(mutex);
      localCallback = callback;
      channels = std::max(1, format.channelCount);
      sampleRate = std::max(8000, format.sampleRate);
      periodFrames = std::max(64, latencyFrames);
    }

    const size_t frameCount = static_cast<size_t>(periodFrames);
    const size_t sampleCount = frameCount * static_cast<size_t>(channels);
    std::vector<float> scratch(sampleCount, 0.0f);
    const auto periodDuration = std::chrono::microseconds(
        static_cast<int64_t>(frameCount) * 1000000 / static_cast<int64_t>(sampleRate));

    while (!stopRequested.load(std::memory_order_acquire) && running.load(std::memory_order_acquire)) {
      std::fill(scratch.begin(), scratch.end(), 0.0f);
      if (localCallback) {
        const size_t rendered = localCallback(scratch.data(), frameCount);
        if (rendered < frameCount) {
          const size_t offset = rendered * static_cast<size_t>(channels);
          std::fill(scratch.begin() + static_cast<std::ptrdiff_t>(offset), scratch.end(), 0.0f);
        }
      }
      std::this_thread::sleep_for(periodDuration);
    }
  }
};

IosAudioUnitBackend::IosAudioUnitBackend() : impl_(std::make_unique<Impl>()) {}

IosAudioUnitBackend::~IosAudioUnitBackend() {
  close();
}

const char* IosAudioUnitBackend::id() const {
  return "audiounit";
}

const char* IosAudioUnitBackend::getBackendName() const {
  return "audiounit";
}

std::vector<PcmDeviceCatalogEntry> IosAudioUnitBackend::enumerateDevices() const {
  return {
      {"auto", "iOS RemoteIO AudioUnit Output", true},
  };
}

bool IosAudioUnitBackend::open(
    const std::string& deviceId,
    const AudioFormat& requestedFormat,
    std::string* error) {
  close();

  if (requestedFormat.sampleRate <= 0 || requestedFormat.channelCount <= 0) {
    if (error) *error = "Invalid requested audio format for iOS AudioUnit output backend";
    return false;
  }

  std::lock_guard lock(impl_->mutex);
  impl_->resetStateLocked();
  impl_->currentDeviceId = deviceId.empty() ? "auto" : deviceId;
  impl_->currentDeviceName =
      (impl_->currentDeviceId == "auto" || impl_->currentDeviceId == "default")
          ? "iOS RemoteIO AudioUnit Output"
          : ("iOS AudioUnit (" + impl_->currentDeviceId + ")");

  impl_->format.sampleRate = requestedFormat.sampleRate;
  impl_->format.channelCount = std::clamp(requestedFormat.channelCount, 1, 8);
  impl_->format.sampleFormat = AudioSampleFormat::Float32Interleaved;
  impl_->format.bitDepth = 32;
  impl_->format.dopEncoded = false;

  const int bufferFrames = impl_->outputConfig.preferredBufferSize > 0
                               ? static_cast<int>(impl_->outputConfig.preferredBufferSize)
                               : kDefaultIosBufferFrames;
  impl_->latencyFrames = std::max(64, bufferFrames);
  impl_->renderScratch.resize(
      static_cast<size_t>(impl_->latencyFrames) * static_cast<size_t>(impl_->format.channelCount),
      0.0f);

  const double bufferMs = framesToLatencyMs(impl_->latencyFrames, impl_->format.sampleRate);
  impl_->info = {};
  impl_->info.exclusive = false;
  impl_->info.accessMode = "shared";
  impl_->info.supportsOutputPerfect = false;
  impl_->info.sourceExact = false;
  impl_->info.outputPerfect = false;
  impl_->info.pcmPassthrough = false;
  impl_->info.resampled = requestedFormat.sampleRate != impl_->format.sampleRate ||
                          requestedFormat.channelCount != impl_->format.channelCount ||
                          effectivePcmBitDepth(requestedFormat) != impl_->format.bitDepth ||
                          requestedFormat.sampleFormat != impl_->format.sampleFormat;
  impl_->info.outputSampleRate = impl_->format.sampleRate;
  impl_->info.outputBitDepth = impl_->format.bitDepth;
  impl_->info.outputChannels = impl_->format.channelCount;
  impl_->info.backend = "audiounit";
  impl_->info.actualBackend = "audiounit";
  impl_->info.devicePathKind = "default";
  impl_->info.deviceName = impl_->currentDeviceName;
  impl_->info.actualDeviceName = impl_->currentDeviceName;
  impl_->info.actualDeviceId = impl_->currentDeviceId;
  impl_->info.actualOutputFormat = sampleFormatToString(impl_->format.sampleFormat);
  impl_->info.actualSampleRate = impl_->format.sampleRate;
  impl_->info.actualBitDepth = impl_->format.bitDepth;
  impl_->info.actualChannels = impl_->format.channelCount;
  impl_->info.bufferSizeFrames = impl_->latencyFrames;
  impl_->info.latencyFrames = impl_->latencyFrames;
  impl_->info.latencyInfo.bufferLatencyMs = bufferMs;
  impl_->info.latencyInfo.outputLatencyMs = bufferMs;
  impl_->info.latencyInfo.totalLatencyMs = bufferMs * 2.0;
  impl_->info.latencyMs = impl_->info.latencyInfo.totalLatencyMs;
  impl_->info.channelRoutingMode = channelRoutingModeToString(impl_->outputConfig.routingMode);
  impl_->info.perfectReasonCode = "shared_mixer";
  impl_->info.perfectReason = "iOS RemoteIO AudioUnit shared output path";
  impl_->info.capabilityReason = impl_->info.perfectReason;
  synchronizeOutputConversionInfo(impl_->info);

  impl_->dopFacts = {};
  impl_->dopFacts.state = DopRuntimeFactState::Unsupported;
  impl_->dopFacts.reason = "iOS RemoteIO AudioUnit shared output path does not prove DoP passthrough";

  impl_->opened.store(true, std::memory_order_release);
  return true;
}

bool IosAudioUnitBackend::setOutputConfig(const OutputConfig& config, std::string* error) {
  (void)error;
  std::lock_guard lock(impl_->mutex);
  impl_->outputConfig = config;
  impl_->info.channelRoutingMode = channelRoutingModeToString(impl_->outputConfig.routingMode);
  return true;
}

bool IosAudioUnitBackend::start(
    RenderCallback callback,
    OutputEventCallback eventCallback,
    std::string* error) {
  if (!impl_->opened.load(std::memory_order_acquire)) {
    if (error) *error = "iOS AudioUnit output backend is not open";
    return false;
  }
  if (impl_->running.exchange(true, std::memory_order_acq_rel)) {
    if (error) *error = "iOS AudioUnit output backend is already running";
    return false;
  }
  {
    std::lock_guard lock(impl_->mutex);
    impl_->callback = std::move(callback);
    impl_->eventCallback = std::move(eventCallback);
  }
  impl_->stopRequested.store(false, std::memory_order_release);
  impl_->renderThread = std::thread([this] { impl_->renderLoop(); });
  return true;
}

void IosAudioUnitBackend::stop() {
  impl_->stopRequested.store(true, std::memory_order_release);
  const bool wasRunning = impl_->running.exchange(false, std::memory_order_acq_rel);
  if (wasRunning && impl_->renderThread.joinable() &&
      impl_->renderThread.get_id() != std::this_thread::get_id()) {
    impl_->renderThread.join();
  }
}

void IosAudioUnitBackend::close() {
  stop();
  if (impl_->renderThread.joinable() &&
      impl_->renderThread.get_id() != std::this_thread::get_id()) {
    impl_->renderThread.join();
  }
  impl_->opened.store(false, std::memory_order_release);
  std::lock_guard lock(impl_->mutex);
  impl_->callback = nullptr;
  impl_->eventCallback = nullptr;
  impl_->resetStateLocked();
}

bool IosAudioUnitBackend::isOpen() const {
  return impl_->opened.load(std::memory_order_acquire);
}

bool IosAudioUnitBackend::isRunning() const {
  return impl_->running.load(std::memory_order_acquire);
}

int IosAudioUnitBackend::getSampleRate() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->format.sampleRate;
}

int IosAudioUnitBackend::getChannels() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->format.channelCount;
}

int IosAudioUnitBackend::getLatencyFrames() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->latencyFrames;
}

AudioFormat IosAudioUnitBackend::outputFormat() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->format;
}

OutputInfo IosAudioUnitBackend::outputInfo() const {
  std::lock_guard lock(impl_->mutex);
  OutputInfo info = impl_->info;
  synchronizeOutputConversionInfo(info);
  return info;
}

DopRuntimeFacts IosAudioUnitBackend::dopRuntimeFacts() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->dopFacts;
}

NativeDsdRuntimeFacts IosAudioUnitBackend::nativeDsdRuntimeFacts() const {
  return unsupportedNativeDsdRuntimeFacts("iOS AudioUnit output backend has no native DSD path");
}

std::string IosAudioUnitBackend::deviceName() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->currentDeviceName;
}

bool iosAudioUnitBackendAvailable() {
#if defined(__APPLE__) && defined(TAE_ENABLE_IOS_AUDIOUNIT)
  return true;
#else
  return false;
#endif
}

}  // namespace twilight::audio
