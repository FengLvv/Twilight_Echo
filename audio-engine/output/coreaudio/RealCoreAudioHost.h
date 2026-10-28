#pragma once

#include "ICoreAudioHost.h"

#include <memory>
#include <string>
#include <vector>

namespace twilight::audio {

class RealCoreAudioHost final : public ICoreAudioHost {
 public:
  RealCoreAudioHost();
  ~RealCoreAudioHost() override;

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

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace twilight::audio
