#pragma once

#include "ICoreAudioHost.h"

#include <map>
#include <string>
#include <vector>

namespace twilight::audio {

class MockCoreAudioHost final : public ICoreAudioHost {
 public:
  struct Device {
    CoreAudioDeviceID id = 1;
    std::string uid;
    std::string name = "Mock CoreAudio";
    int channelCount = 2;
    double nominalSampleRate = 48000.0;
    std::vector<double> availableSampleRates = {44100.0, 48000.0, 96000.0};
    CoreAudioStreamBasicDescription streamFormat{};
    uint32_t bufferFrameSize = 512;
    uint32_t outputLatencyFrames = 128;
  };

  std::vector<Device> devices;
  CoreAudioDeviceID nextUnitHandle = 1;
  CoreAudioDeviceID selectedDeviceId = 0;
  CoreAudioAudioUnit lastAudioUnit = 0;
  CoreAudioRenderCallback renderCallback;
  CoreAudioDeviceLostCallback deviceLostCallback;
  CoreAudioListenerToken deviceLostListenerToken = 0;
  CoreAudioDeviceID deviceLostListenerDeviceId = 0;
  CoreAudioDeviceID ownerPidDeviceId = 0;
  int32_t existingHogOwnerPid = -1;
  bool failNominalRateSet = false;
  bool failAcquireHogMode = false;
  bool failNewAudioUnit = false;
  bool failSetRenderCallback = false;
  bool failAudioUnitInitialize = false;
  bool failAudioUnitStart = false;
  bool deviceLostOnNextRender = false;
  uint32_t shortRenderFrameCount = 0;
  std::vector<std::string> callLog;
  int findOutputDeviceCalls = 0;
  int acquireHogModeCalls = 0;
  int releaseHogModeCalls = 0;
  int setNominalSampleRateCalls = 0;
  int supportsNominalSampleRateCalls = 0;
  int deviceOutputStreamFormatCalls = 0;
  int hogModeOwnerPidCalls = 0;
  int availableNominalSampleRatesCalls = 0;
  int findHalOutputUnitCalls = 0;
  int newAudioUnitCalls = 0;
  int enableIOBusCalls = 0;
  int bindDeviceCalls = 0;
  int applyBufferSizeCalls = 0;
  int currentBufferFrameSizeCalls = 0;
  int setStreamFormatCalls = 0;
  int setRenderCallbackCalls = 0;
  int audioUnitInitializeCalls = 0;
  int audioUnitStartCalls = 0;
  int audioUnitStopCalls = 0;
  int audioUnitUninitializeCalls = 0;
  int disposeAudioUnitCalls = 0;
  int addDeviceLostListenerCalls = 0;
  int removeDeviceLostListenerCalls = 0;

  bool findOutputDevice(const std::string& requestedDeviceId, CoreAudioDeviceID* outDeviceId, std::string* error) override;
  std::string deviceName(CoreAudioDeviceID deviceId) override;
  std::string deviceUid(CoreAudioDeviceID deviceId) override;
  int outputChannelCount(CoreAudioDeviceID deviceId) override;
  double getNominalSampleRate(CoreAudioDeviceID deviceId) override;
  bool setNominalSampleRate(CoreAudioDeviceID deviceId, double rate, std::string* error) override;
  bool supportsNominalSampleRate(CoreAudioDeviceID deviceId, double rate) override;
  std::vector<double> availableNominalSampleRates(CoreAudioDeviceID deviceId) override;
  bool deviceOutputStreamFormat(
      CoreAudioDeviceID deviceId,
      CoreAudioStreamBasicDescription* out,
      std::string* error) override;
  bool hogModeOwnerPid(CoreAudioDeviceID deviceId, int32_t* ownerPid, std::string* error) override;
  bool acquireHogMode(CoreAudioDeviceID deviceId, int32_t* existingOwnerPid, std::string* error) override;
  void releaseHogMode(CoreAudioDeviceID deviceId) override;

  bool findHalOutputUnit(std::string* error) override;
  bool newAudioUnit(CoreAudioAudioUnit* outUnit, std::string* error) override;
  bool enableIOBus(CoreAudioAudioUnit unit, bool input, bool enable, std::string* error) override;
  bool bindDevice(CoreAudioAudioUnit unit, CoreAudioDeviceID deviceId, std::string* error) override;
  bool applyBufferSize(CoreAudioDeviceID deviceId, uint32_t preferredBufferSize, std::string* error) override;
  uint32_t currentBufferFrameSize(CoreAudioDeviceID deviceId) override;
  uint32_t estimatedOutputLatencyFrames(CoreAudioDeviceID deviceId) override;
  bool setStreamFormat(
      CoreAudioAudioUnit unit,
      bool input,
      const CoreAudioStreamBasicDescription& format,
      std::string* error) override;
  bool setRenderCallback(CoreAudioAudioUnit unit, CoreAudioRenderCallback callback, std::string* error) override;
  bool audioUnitInitialize(CoreAudioAudioUnit unit, std::string* error) override;
  bool audioUnitStart(CoreAudioAudioUnit unit, std::string* error) override;
  void audioUnitStop(CoreAudioAudioUnit unit) override;
  void audioUnitUninitialize(CoreAudioAudioUnit unit) override;
  void disposeAudioUnit(CoreAudioAudioUnit unit) override;

  CoreAudioListenerToken addDeviceLostListener(
      CoreAudioDeviceID deviceId,
      CoreAudioDeviceLostCallback callback,
      std::string* error) override;
  void removeDeviceLostListener(CoreAudioDeviceID deviceId, CoreAudioListenerToken token) override;

  size_t triggerRender(uint32_t frameCount);
  void triggerDeviceLost(const std::string& message = "device removed");

 private:
  Device* findDevice(CoreAudioDeviceID deviceId);
  const Device* findDevice(CoreAudioDeviceID deviceId) const;
};

}  // namespace twilight::audio
