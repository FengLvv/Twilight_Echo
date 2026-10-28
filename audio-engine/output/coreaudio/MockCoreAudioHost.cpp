#include "MockCoreAudioHost.h"

#include <algorithm>
#include <cmath>

namespace twilight::audio {

namespace {

CoreAudioStreamBasicDescription makeDefaultStreamFormat(int channels, double sampleRate) {
  CoreAudioStreamBasicDescription format;
  format.sampleRate = sampleRate;
  format.formatID = 0x6c70636d;
  format.formatFlags = 0x1;
  format.framesPerPacket = 1;
  format.channelsPerFrame = static_cast<uint32_t>(std::max(1, channels));
  format.bitsPerChannel = 32;
  format.bytesPerPacket = format.channelsPerFrame * 4;
  format.bytesPerFrame = format.channelsPerFrame * 4;
  return format;
}

}  // namespace

MockCoreAudioHost::Device* MockCoreAudioHost::findDevice(CoreAudioDeviceID deviceId) {
  auto it = std::find_if(devices.begin(), devices.end(), [&](const Device& device) { return device.id == deviceId; });
  return it == devices.end() ? nullptr : &*it;
}

const MockCoreAudioHost::Device* MockCoreAudioHost::findDevice(CoreAudioDeviceID deviceId) const {
  auto it = std::find_if(devices.begin(), devices.end(), [&](const Device& device) { return device.id == deviceId; });
  return it == devices.end() ? nullptr : &*it;
}

bool MockCoreAudioHost::findOutputDevice(const std::string& requestedDeviceId, CoreAudioDeviceID* outDeviceId, std::string* error) {
  ++findOutputDeviceCalls;
  callLog.push_back("findOutputDevice:" + requestedDeviceId);
  if (devices.empty()) {
    if (error) *error = "mock coreaudio device not found";
    return false;
  }
  if (!requestedDeviceId.empty() && requestedDeviceId != "auto" && requestedDeviceId != "default") {
    for (const auto& device : devices) {
      if ((!device.uid.empty() && device.uid == requestedDeviceId) ||
          device.name == requestedDeviceId ||
          std::to_string(device.id) == requestedDeviceId) {
        if (outDeviceId) *outDeviceId = device.id;
        return true;
      }
    }
    if (error) *error = "mock coreaudio device not found: " + requestedDeviceId;
    return false;
  }
  if (outDeviceId) *outDeviceId = devices.front().id;
  return true;
}

std::string MockCoreAudioHost::deviceName(CoreAudioDeviceID deviceId) {
  const Device* device = findDevice(deviceId);
  return device ? device->name : std::string{};
}

std::string MockCoreAudioHost::deviceUid(CoreAudioDeviceID deviceId) {
  const Device* device = findDevice(deviceId);
  if (!device) return {};
  return !device->uid.empty() ? device->uid : std::to_string(device->id);
}

int MockCoreAudioHost::outputChannelCount(CoreAudioDeviceID deviceId) {
  const Device* device = findDevice(deviceId);
  return device ? device->channelCount : 0;
}

double MockCoreAudioHost::getNominalSampleRate(CoreAudioDeviceID deviceId) {
  const Device* device = findDevice(deviceId);
  return device ? device->nominalSampleRate : 0.0;
}

bool MockCoreAudioHost::setNominalSampleRate(CoreAudioDeviceID deviceId, double rate, std::string* error) {
  ++setNominalSampleRateCalls;
  callLog.push_back("setNominalSampleRate:" + std::to_string(deviceId) + ":" + std::to_string(rate));
  if (failNominalRateSet) {
    if (error) *error = "mock nominal sample rate failure";
    return false;
  }
  Device* device = findDevice(deviceId);
  if (!device) {
    if (error) *error = "mock coreaudio device missing";
    return false;
  }
  device->nominalSampleRate = rate;
  return true;
}

bool MockCoreAudioHost::supportsNominalSampleRate(CoreAudioDeviceID deviceId, double rate) {
  ++supportsNominalSampleRateCalls;
  const Device* device = findDevice(deviceId);
  if (!device) return false;
  if (device->availableSampleRates.empty()) return true;
  return std::find_if(device->availableSampleRates.begin(), device->availableSampleRates.end(), [&](double candidate) {
           return std::abs(candidate - rate) < 0.5;
         }) != device->availableSampleRates.end();
}

std::vector<double> MockCoreAudioHost::availableNominalSampleRates(CoreAudioDeviceID deviceId) {
  ++availableNominalSampleRatesCalls;
  const Device* device = findDevice(deviceId);
  return device ? device->availableSampleRates : std::vector<double>{};
}

bool MockCoreAudioHost::deviceOutputStreamFormat(
    CoreAudioDeviceID deviceId,
    CoreAudioStreamBasicDescription* out,
    std::string* error) {
  ++deviceOutputStreamFormatCalls;
  callLog.push_back("deviceOutputStreamFormat:" + std::to_string(deviceId));
  const Device* device = findDevice(deviceId);
  if (!device) {
    if (error) *error = "mock coreaudio device missing";
    return false;
  }
  if (out) {
    *out = device->streamFormat.sampleRate > 0.0 ? device->streamFormat : makeDefaultStreamFormat(device->channelCount, device->nominalSampleRate);
  }
  return true;
}

bool MockCoreAudioHost::hogModeOwnerPid(CoreAudioDeviceID deviceId, int32_t* ownerPid, std::string* error) {
  ++hogModeOwnerPidCalls;
  callLog.push_back("hogModeOwnerPid:" + std::to_string(deviceId));
  if (!findDevice(deviceId)) {
    if (error) *error = "mock coreaudio device missing";
    return false;
  }
  if (ownerPid) *ownerPid = existingHogOwnerPid;
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::acquireHogMode(CoreAudioDeviceID deviceId, int32_t* existingOwnerPid, std::string* error) {
  ++acquireHogModeCalls;
  ownerPidDeviceId = deviceId;
  callLog.push_back("acquireHogMode:" + std::to_string(deviceId));
  if (existingOwnerPid) *existingOwnerPid = this->existingHogOwnerPid;
  if (failAcquireHogMode) {
    if (error) *error = "mock hog mode failure";
    return false;
  }
  return this->existingHogOwnerPid == -1;
}

void MockCoreAudioHost::releaseHogMode(CoreAudioDeviceID deviceId) {
  ++releaseHogModeCalls;
  callLog.push_back("releaseHogMode:" + std::to_string(deviceId));
}

bool MockCoreAudioHost::findHalOutputUnit(std::string* error) {
  ++findHalOutputUnitCalls;
  callLog.push_back("findHalOutputUnit");
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::newAudioUnit(CoreAudioAudioUnit* outUnit, std::string* error) {
  ++newAudioUnitCalls;
  callLog.push_back("newAudioUnit");
  if (failNewAudioUnit) {
    if (error) *error = "mock new audio unit failure";
    return false;
  }
  lastAudioUnit = nextUnitHandle++;
  if (outUnit) *outUnit = lastAudioUnit;
  return true;
}

bool MockCoreAudioHost::enableIOBus(CoreAudioAudioUnit unit, bool input, bool enable, std::string* error) {
  ++enableIOBusCalls;
  callLog.push_back("enableIOBus:" + std::to_string(unit) + ":" + std::to_string(input ? 1 : 0) + ":" + std::to_string(enable ? 1 : 0));
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::bindDevice(CoreAudioAudioUnit unit, CoreAudioDeviceID deviceId, std::string* error) {
  ++bindDeviceCalls;
  selectedDeviceId = deviceId;
  callLog.push_back("bindDevice:" + std::to_string(unit) + ":" + std::to_string(deviceId));
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::applyBufferSize(CoreAudioDeviceID deviceId, uint32_t preferredBufferSize, std::string* error) {
  ++applyBufferSizeCalls;
  callLog.push_back("applyBufferSize:" + std::to_string(deviceId) + ":" + std::to_string(preferredBufferSize));
  if (preferredBufferSize > 0) {
    if (Device* device = findDevice(deviceId)) device->bufferFrameSize = preferredBufferSize;
  }
  if (error) error->clear();
  return true;
}

uint32_t MockCoreAudioHost::currentBufferFrameSize(CoreAudioDeviceID deviceId) {
  ++currentBufferFrameSizeCalls;
  callLog.push_back("currentBufferFrameSize:" + std::to_string(deviceId));
  const Device* device = findDevice(deviceId);
  return device ? device->bufferFrameSize : 0;
}

uint32_t MockCoreAudioHost::estimatedOutputLatencyFrames(CoreAudioDeviceID deviceId) {
  callLog.push_back("estimatedOutputLatencyFrames:" + std::to_string(deviceId));
  if (const Device* device = findDevice(deviceId)) return device->outputLatencyFrames;
  return 0;
}


bool MockCoreAudioHost::setStreamFormat(
    CoreAudioAudioUnit unit,
    bool input,
    const CoreAudioStreamBasicDescription& format,
    std::string* error) {
  ++setStreamFormatCalls;
  callLog.push_back("setStreamFormat:" + std::to_string(unit) + ":" + std::to_string(input ? 1 : 0));
  (void)format;
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::setRenderCallback(CoreAudioAudioUnit unit, CoreAudioRenderCallback callback, std::string* error) {
  ++setRenderCallbackCalls;
  callLog.push_back("setRenderCallback:" + std::to_string(unit));
  if (failSetRenderCallback) {
    if (error) *error = "mock render callback failure";
    return false;
  }
  renderCallback = std::move(callback);
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::audioUnitInitialize(CoreAudioAudioUnit unit, std::string* error) {
  ++audioUnitInitializeCalls;
  callLog.push_back("audioUnitInitialize:" + std::to_string(unit));
  if (failAudioUnitInitialize) {
    if (error) *error = "mock audio unit initialize failure";
    return false;
  }
  if (error) error->clear();
  return true;
}

bool MockCoreAudioHost::audioUnitStart(CoreAudioAudioUnit unit, std::string* error) {
  ++audioUnitStartCalls;
  callLog.push_back("audioUnitStart:" + std::to_string(unit));
  if (failAudioUnitStart) {
    if (error) *error = "mock audio unit start failure";
    return false;
  }
  if (error) error->clear();
  return true;
}

void MockCoreAudioHost::audioUnitStop(CoreAudioAudioUnit unit) {
  ++audioUnitStopCalls;
  callLog.push_back("audioUnitStop:" + std::to_string(unit));
}

void MockCoreAudioHost::audioUnitUninitialize(CoreAudioAudioUnit unit) {
  ++audioUnitUninitializeCalls;
  callLog.push_back("audioUnitUninitialize:" + std::to_string(unit));
}

void MockCoreAudioHost::disposeAudioUnit(CoreAudioAudioUnit unit) {
  ++disposeAudioUnitCalls;
  callLog.push_back("disposeAudioUnit:" + std::to_string(unit));
}

CoreAudioListenerToken MockCoreAudioHost::addDeviceLostListener(
    CoreAudioDeviceID deviceId,
    CoreAudioDeviceLostCallback callback,
    std::string* error) {
  ++addDeviceLostListenerCalls;
  deviceLostListenerDeviceId = deviceId;
  deviceLostCallback = std::move(callback);
  deviceLostListenerToken = 1;
  callLog.push_back("addDeviceLostListener:" + std::to_string(deviceId));
  if (error) error->clear();
  return deviceLostListenerToken;
}

void MockCoreAudioHost::removeDeviceLostListener(CoreAudioDeviceID deviceId, CoreAudioListenerToken token) {
  ++removeDeviceLostListenerCalls;
  callLog.push_back("removeDeviceLostListener:" + std::to_string(deviceId) + ":" + std::to_string(token));
  if (deviceLostListenerToken == token) {
    deviceLostCallback = nullptr;
    deviceLostListenerToken = 0;
  }
}

size_t MockCoreAudioHost::triggerRender(uint32_t frameCount) {
  if (!renderCallback) return 0;
  CoreAudioBufferList ioData;
  ioData.buffers.resize(1);
  auto* device = findDevice(selectedDeviceId);
  const uint32_t channels = device ? static_cast<uint32_t>(std::max(1, device->channelCount)) : 2;
  const size_t bytesPerFrame = static_cast<size_t>(channels) * sizeof(float);
  ioData.buffers[0].numberChannels = channels;
  ioData.buffers[0].data.assign(static_cast<size_t>(frameCount) * bytesPerFrame, 0);
  ioData.buffers[0].dataByteSize = static_cast<uint32_t>(ioData.buffers[0].data.size());
  size_t rendered = renderCallback(frameCount, ioData);
  if (deviceLostOnNextRender) {
    deviceLostOnNextRender = false;
    triggerDeviceLost("mock device lost during render");
  }
  if (shortRenderFrameCount > 0 && rendered > shortRenderFrameCount) {
    rendered = shortRenderFrameCount;
  }
  return rendered;
}

void MockCoreAudioHost::triggerDeviceLost(const std::string& message) {
  if (deviceLostCallback) deviceLostCallback(message);
}

}  // namespace twilight::audio
