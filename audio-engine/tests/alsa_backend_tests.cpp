#include "../output/alsa/AlsaBackend.h"
#include "../output/alsa/AlsaRenderUtils.h"
#include "../output/alsa/MockAlsaHost.h"

#include <algorithm>
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <chrono>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <thread>

using namespace twilight::audio;

namespace {

AudioFormat sourceFormat(
    int sampleRate = 96000,
    int bitDepth = 24,
    int channels = 2,
    AudioSampleFormat sampleFormat = AudioSampleFormat::Int24Interleaved) {
  AudioFormat format;
  format.sampleRate = sampleRate;
  format.bitDepth = bitDepth;
  format.channelCount = channels;
  format.sampleFormat = sampleFormat;
  return format;
}

bool waitForWrites(
    MockAlsaHost* host,
    int minimumWrites,
    std::chrono::milliseconds timeout = std::chrono::milliseconds(80)) {
  const auto deadline = std::chrono::steady_clock::now() + timeout;
  while (std::chrono::steady_clock::now() < deadline) {
    if (host->writeCalls >= minimumWrites) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return host->writeCalls >= minimumWrites;
}

std::string readTextFile(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  return buffer.str();
}

std::string extractFunctionBody(const std::string& source, const std::string& signature) {
  const size_t signaturePos = source.find(signature);
  assert(signaturePos != std::string::npos);
  const size_t bodyStart = source.find('{', signaturePos);
  assert(bodyStart != std::string::npos);
  int depth = 0;
  for (size_t i = bodyStart; i < source.size(); ++i) {
    if (source[i] == '{') {
      ++depth;
    } else if (source[i] == '}') {
      --depth;
      if (depth == 0) return source.substr(bodyStart, i - bodyStart + 1);
    }
  }
  assert(false);
  return {};
}

void testAlsaRenderLoopsUseNoResizeHelpers() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "output" / "alsa" / "AlsaBackend.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string packBody = extractFunctionBody(source, "void pack(const float* input, size_t frames, int channels)");
  const std::string renderLoopBody = extractFunctionBody(source, "void renderLoop()");
  const std::string typedRenderLoopBody = extractFunctionBody(source, "void typedRenderLoop()");

  assert(packBody.find("packFloatScratchToPcmScratchNoResize") != std::string::npos);
  assert(packBody.find("packFloatScratchToPcmScratch(") == std::string::npos);
  assert(renderLoopBody.find("renderFloatPeriodWithTailSilenceNoResize") != std::string::npos);
  assert(renderLoopBody.find("renderFloatPeriodWithTailSilence(") == std::string::npos);
  assert(typedRenderLoopBody.find("renderDsdPeriodWithTailSilenceAndRepackNoResize") != std::string::npos);
  assert(typedRenderLoopBody.find("renderDsdPeriodWithTailSilenceAndRepack(") == std::string::npos);
}

void testAlsaRenderLoopsDoNotBlockOnBackendMutex() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "output" / "alsa" / "AlsaBackend.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderLoopBody = extractFunctionBody(source, "void renderLoop()");
  const std::string typedRenderLoopBody = extractFunctionBody(source, "void typedRenderLoop()");

  assert(renderLoopBody.find("mutex") != std::string::npos);
  assert(typedRenderLoopBody.find("mutex") != std::string::npos);
  assert(renderLoopBody.find("std::lock_guard lock(mutex)") == std::string::npos);
  assert(typedRenderLoopBody.find("std::lock_guard lock(mutex)") == std::string::npos);
  assert(renderLoopBody.find("std::try_to_lock") == std::string::npos);
  assert(typedRenderLoopBody.find("std::try_to_lock") == std::string::npos);
  assert(renderLoopBody.find("sleep_for") == std::string::npos);
  assert(typedRenderLoopBody.find("sleep_for") == std::string::npos);
}

void testAlsaRenderLoopsQueueRecoveryOffRenderThread() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "output" / "alsa" / "AlsaBackend.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string renderLoopBody = extractFunctionBody(source, "void renderLoop()");
  const std::string typedRenderLoopBody = extractFunctionBody(source, "void typedRenderLoop()");
  const std::string queueBody = extractFunctionBody(source, "void queueWriteRecoveryFromRenderThread(");

  assert(renderLoopBody.find("queueWriteRecoveryFromRenderThread") != std::string::npos);
  assert(typedRenderLoopBody.find("queueWriteRecoveryFromRenderThread") != std::string::npos);
  assert(renderLoopBody.find("recoverFromWriteError") == std::string::npos);
  assert(typedRenderLoopBody.find("recoverFromWriteError") == std::string::npos);
  assert(renderLoopBody.find("failureCallback") == std::string::npos);
  assert(typedRenderLoopBody.find("failureCallback") == std::string::npos);
  assert(queueBody.find("recoverFromWriteError") == std::string::npos);
  assert(queueBody.find("joinRecoveryThread") == std::string::npos);
  assert(queueBody.find("std::thread") == std::string::npos);
  assert(queueBody.find("std::string") == std::string::npos);
  assert(queueBody.find("std::lock_guard") == std::string::npos);
}

void testAlsaStartRejectsRepeatedStartBeforeLaunchingThread() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "output" / "alsa" / "AlsaBackend.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string startBody = extractFunctionBody(source, "bool AlsaBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error)");
  const std::string startTypedBody = extractFunctionBody(source, "bool AlsaBackend::startTyped(");

  assert(startBody.find("running.load()") != std::string::npos);
  assert(startBody.find("launchRenderThread") != std::string::npos);
  assert(startBody.find("running.load()") < startBody.find("launchRenderThread"));
  assert(startTypedBody.find("running.load()") != std::string::npos);
  assert(startTypedBody.find("launchRenderThread") != std::string::npos);
  assert(startTypedBody.find("running.load()") < startTypedBody.find("launchRenderThread"));
}

void testAlsaRepeatedStartReturnsFalseWithoutRelaunchingThread() {
  auto host = std::make_unique<MockAlsaHost>();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
  assert(backend.start([](float*, size_t frames) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return frames;
  }, nullptr, &error));

  error.clear();
  assert(!backend.start([](float*, size_t frames) { return frames; }, nullptr, &error));
  assert(!error.empty());
  backend.stop();
}

void testAlsaOpenNegotiatesPcm() {
  auto host = std::make_unique<MockAlsaHost>();
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(), &error));
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::S24_3Le);
  assert(rawHost->requestedRate == 96000);
  assert(rawHost->hwParamsApplyCalls == 1);

  const OutputInfo info = backend.outputInfo();
  assert(info.actualOutputFormat == sampleFormatToString(AudioSampleFormat::Int24Interleaved));
  assert(info.actualBitDepth == 24);
  assert(info.actualChannels == 2);
  assert(info.actualSampleRate == 96000);
}

void testAlsaDefaultBufferUsesEightPeriods() {
  auto host = std::make_unique<MockAlsaHost>();
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));

  assert(rawHost->requestedPeriodSize == 512);
  assert(rawHost->requestedBufferSize == 512 * 8);
  assert(rawHost->negotiatedPeriodSize == 512);
  assert(rawHost->negotiatedBufferSize == 512 * 8);
  const OutputInfo info = backend.outputInfo();
  assert(info.bufferSizeFrames == 512 * 8);
  assert(info.latencyFrames == 512 * 8);
  assert(info.latencyInfo.bufferLatencyMs > 10.0);
  assert(info.latencyInfo.outputLatencyMs > info.latencyInfo.bufferLatencyMs);
  assert(info.latencyInfo.totalLatencyMs == info.latencyMs);
}

void testAlsaFormatFallback() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::S16Le};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(), &error));
  assert(std::find(rawHost->testedFormats.begin(), rawHost->testedFormats.end(), AlsaPcmFormat::S24_3Le) !=
         rawHost->testedFormats.end());
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::S16Le);
  assert(backend.outputInfo().actualBitDepth == 16);
}

void testAlsaXrunRecovery() {
  auto host = std::make_unique<MockAlsaHost>();
  host->pendingWriteErrors = {kAlsaErrEpipe};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
  assert(backend.start([](float*, size_t frames) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return frames;
  }, nullptr, &error));
  assert(waitForWrites(rawHost, 2));
  backend.stop();

  const OutputInfo info = backend.outputInfo();
  assert(info.diagnostics.sessionUnderrunCount >= 1);
  assert(info.diagnostics.sessionRecoveryCount >= 1);
  assert(info.deviceRecovered);
  assert(rawHost->prepareCalls >= 2);
}

void testAlsaSuspendRecovery() {
  auto host = std::make_unique<MockAlsaHost>();
  host->pendingWriteErrors = {kAlsaErrEstrpipe};
  host->resumeReturn = 0;
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;

  assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
  assert(backend.start([](float*, size_t frames) {
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
    return frames;
  }, nullptr, &error));
  assert(waitForWrites(rawHost, 2));
  backend.stop();

  const OutputInfo info = backend.outputInfo();
  assert(info.diagnostics.sessionUnderrunCount >= 1);
  assert(info.diagnostics.sessionRecoveryCount >= 1);
  assert(info.deviceRecovered);
  assert(rawHost->resumeCalls >= 1);
  assert(rawHost->prepareCalls >= 2);
}

void testAlsaHwDevicePathKind() {
  {
    auto host = std::make_unique<MockAlsaHost>();
    AlsaBackend backend(std::move(host));
    std::string error;
    assert(backend.open("hw:0,0", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
    const OutputInfo info = backend.outputInfo();
    assert(info.accessMode == "direct");
    assert(info.devicePathKind == "hw");
    assert(info.actualDeviceId == "hw:0,0");
    assert(info.exclusive);
  }
  {
    auto host = std::make_unique<MockAlsaHost>();
    AlsaBackend backend(std::move(host));
    std::string error;
    assert(backend.open("plughw:0,0", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
    const OutputInfo info = backend.outputInfo();
    assert(info.devicePathKind == "plughw");
    assert(info.actualDeviceId == "plughw:0,0");
    assert(info.accessMode == "plugin");
  }
  {
    auto host = std::make_unique<MockAlsaHost>();
    AlsaBackend backend(std::move(host));
    std::string error;
    assert(backend.open("default", sourceFormat(48000, 16, 2, AudioSampleFormat::Int16Interleaved), &error));
    assert(backend.outputInfo().devicePathKind == "default");
    assert(backend.outputInfo().actualDeviceId == "default");
  }
}

// --- Native DSD tests (DSD64/128/256/512 via DSD_U8 / DSD_U16_LE / DSD_U32_LE) ---

AudioFormat dsdFormat(int bitClock, int channels = 2) {
  return sourceFormat(bitClock, 1, channels, AudioSampleFormat::DsdInt8Msb1);
}

void testAlsaDsd64SelectsU8() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::DsdU8);
  // ALSA rate = 2822400 / 8 (phys_width bits) = 352800
  assert(rawHost->requestedRate == 352800);
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.requestedDsdRate == 2822400);
  assert(facts.actualDsdRate == 2822400);
  assert(facts.state == NativeDsdRuntimeFactState::Candidate);
}

void testAlsaDsd256SelectsU16Le() {
  auto host = std::make_unique<MockAlsaHost>();
  // Only accept U16Le — U8 and U32Le must be rejected first (MPD order: U8→U32Le→U16Le)
  host->acceptedFormats = {AlsaPcmFormat::DsdU16Le};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(11289600), &error));
  assert(std::find(rawHost->testedFormats.begin(), rawHost->testedFormats.end(), AlsaPcmFormat::DsdU8) !=
         rawHost->testedFormats.end());
  assert(std::find(rawHost->testedFormats.begin(), rawHost->testedFormats.end(), AlsaPcmFormat::DsdU32Le) !=
         rawHost->testedFormats.end());
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::DsdU16Le);
  // ALSA rate = 11289600 / 16 = 705600
  assert(rawHost->requestedRate == 705600);
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.requestedDsdRate == 11289600);
  assert(facts.actualDsdRate == 11289600);
}

void testAlsaDsd512SelectsU32Le() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU32Le};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(22579200), &error));
  assert(!rawHost->setFormats.empty());
  assert(rawHost->setFormats.front() == AlsaPcmFormat::DsdU32Le);
  // ALSA rate = 22579200 / 32 = 705600
  assert(rawHost->requestedRate == 705600);
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.requestedDsdRate == 22579200);
  assert(facts.actualDsdRate == 22579200);
}

void testAlsaNativeDsdRuntimeFactsCandidateAtOpen() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));
  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.state == NativeDsdRuntimeFactState::Candidate);
  assert(facts.explicitlyCapable);
  assert(facts.requestedDsdRate == 2822400);
  assert(facts.actualDsdRate == 2822400);
  assert(facts.channelCount == 2);
  assert(facts.advertisedSampleRates.size() == 4);
}

void testAlsaNativeDsdRuntimeFactsProvenAfterWritei() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));
  assert(backend.nativeDsdRuntimeFacts().state == NativeDsdRuntimeFactState::Candidate);

  assert(backend.startTyped(
      [](PcmBlock& block) {
        std::memset(block.data, 0xaa, block.byteSize);
        return block.frames;
      },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  const NativeDsdRuntimeFacts facts = backend.nativeDsdRuntimeFacts();
  assert(facts.state == NativeDsdRuntimeFactState::Proven);
  assert(facts.actualDsdRate == 2822400);
}

void testAlsaNativeDsdOutputInfoReflectsRuntimeProof() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));

  const OutputInfo candidateInfo = backend.outputInfo();
  assert(candidateInfo.nativeDsdRuntimeState == "candidate");
  assert(candidateInfo.nativeDsdRequestedRate == 2822400);
  assert(candidateInfo.nativeDsdActualRate == 2822400);
  assert(candidateInfo.nativeDsdChannels == 2);
  assert(candidateInfo.nativeDsdExplicitlyCapable);
  assert(!candidateInfo.supportsOutputPerfect);

  assert(backend.startTyped(
      [](PcmBlock& block) {
        std::memset(block.data, 0x69, block.byteSize);
        return block.frames;
      },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  const OutputInfo provenInfo = backend.outputInfo();
  assert(provenInfo.nativeDsdRuntimeState == "proven");
  assert(provenInfo.nativeDsdRequestedRate == 2822400);
  assert(provenInfo.nativeDsdActualRate == 2822400);
  assert(provenInfo.nativeDsdChannels == 2);
  assert(provenInfo.nativeDsdExplicitlyCapable);
  assert(provenInfo.supportsOutputPerfect);
  assert(!provenInfo.resampled);
  assert(provenInfo.perfectReasonCode.empty());
  assert(provenInfo.perfectReason.empty());
}

void testAlsaDsdBypassesFloat() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  host->negotiatedPeriodSize = 4;
  host->negotiatedBufferSize = 32;
  host->negotiatedChannels = 2;
  // DsdU8 stereo: 1 byte/sample * 2 channels = 2 bytes/frame
  host->captureFrameBytes = 2;
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));

  assert(backend.startTyped(
      [](PcmBlock& block) {
        for (size_t i = 0; i < block.byteSize; ++i) {
          block.data[i] = static_cast<uint8_t>((i * 17 + 0x5a) & 0xff);
        }
        return block.frames;
      },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  // Raw byte copy — no float→int conversion, output must equal input DSD bytes.
  assert(!rawHost->capturedWriteBytes.empty());
  for (size_t i = 0; i < rawHost->capturedWriteBytes.size(); ++i) {
    assert(rawHost->capturedWriteBytes[i] == static_cast<uint8_t>((i * 17 + 0x5a) & 0xff));
  }
}

void testAlsaDsdSilenceIs0x69() {
  auto host = std::make_unique<MockAlsaHost>();
  host->acceptedFormats = {AlsaPcmFormat::DsdU8};
  host->negotiatedPeriodSize = 4;
  host->negotiatedBufferSize = 32;
  host->negotiatedChannels = 2;
  host->captureFrameBytes = 2;
  auto* rawHost = host.get();
  AlsaBackend backend(std::move(host));
  std::string error;
  assert(backend.open("hw:0,0", dsdFormat(2822400), &error));

  // Typed callback renders 0 frames — remainder must be DSD silence 0x69, not 0x00.
  assert(backend.startTyped(
      [](PcmBlock& block) { return static_cast<size_t>(0); },
      [](float*, size_t frames) { return frames; },
      nullptr,
      &error));
  assert(waitForWrites(rawHost, 1));
  backend.stop();

  assert(!rawHost->capturedWriteBytes.empty());
  for (uint8_t byte : rawHost->capturedWriteBytes) {
    assert(byte == 0x69);
  }
}

void testAlsaFloatRenderHelperZerosOnlyUnrenderedTail() {
  std::vector<float> scratch = {
      -1.0f, -1.0f,
      -1.0f, -1.0f,
      -1.0f, -1.0f,
  };

  const size_t rendered = alsa::renderFloatPeriodWithTailSilence(
      scratch,
      3,
      2,
      [](float* output, size_t frames) {
        assert(frames == 3);
        output[0] = 0.5f;
        output[1] = -0.5f;
        return static_cast<size_t>(1);
      });

  assert(rendered == 1);
  assert(scratch[0] == 0.5f);
  assert(scratch[1] == -0.5f);
  for (size_t index = 2; index < scratch.size(); ++index) {
    assert(scratch[index] == 0.0f);
  }
}

void testAlsaFloatRenderHelperDoesNotPreclearFullRender() {
  std::vector<float> scratch = {
      -1.0f, -1.0f,
      -1.0f, -1.0f,
  };

  const size_t rendered = alsa::renderFloatPeriodWithTailSilence(
      scratch,
      2,
      2,
      [](float* output, size_t frames) {
        assert(frames == 2);
        for (size_t sample = 0; sample < frames * 2; ++sample) {
          assert(output[sample] == -1.0f);
          output[sample] = static_cast<float>(sample + 1);
        }
        return frames;
      });

  assert(rendered == 2);
  assert(scratch[0] == 1.0f);
  assert(scratch[1] == 2.0f);
  assert(scratch[2] == 3.0f);
  assert(scratch[3] == 4.0f);
}

void testAlsaFloatRenderHelperZerosAllWithoutCallback() {
  std::vector<float> scratch = {
      -1.0f, -1.0f,
      -1.0f, -1.0f,
  };

  const size_t rendered = alsa::renderFloatPeriodWithTailSilence(
      scratch,
      2,
      2,
      RenderCallback{});

  assert(rendered == 0);
  for (float sample : scratch) {
    assert(sample == 0.0f);
  }
}

void testAlsaDsdRepackPrepareSilencesPaddingWithoutClearingSourceSlots() {
  const size_t frames = 2;
  const int channels = 2;
  const int physWidthBytes = 2;
  const size_t frameBytes = 6;
  std::vector<uint8_t> repackScratch(frames * frameBytes, 0x44);

  alsa::prepareDsdRepackScratchWithSilencePadding(
      repackScratch,
      frames,
      frameBytes,
      channels,
      physWidthBytes);

  const std::vector<uint8_t> expected = {
      0x44, 0x44, 0x44, 0x44, 0x69, 0x69,
      0x44, 0x44, 0x44, 0x44, 0x69, 0x69,
  };
  if (repackScratch != expected) std::abort();
}

void testAlsaDsdSilenceScratchSkipsRewriteWhenAlreadySilent() {
  std::vector<uint8_t> scratch(4, 0x69);
  bool knownSilence = true;

  const size_t rewritten = alsa::prepareDsdSilenceScratch(scratch, 4, knownSilence);

  assert(rewritten == 0);
  assert(knownSilence);
  assert((scratch == std::vector<uint8_t>{0x69, 0x69, 0x69, 0x69}));
}

void testAlsaDsdRenderHelperReusesScratchAndRepackBuffers() {
  std::vector<uint8_t> typedScratch(1, 0x11);
  std::vector<uint8_t> repackScratch(1, 0x22);
  const size_t frames = 2;
  const int channels = 2;
  const int physWidthBytes = 2;
  const size_t frameBytes = static_cast<size_t>(channels * physWidthBytes);

  const auto result = alsa::renderDsdPeriodWithTailSilenceAndRepack(
      typedScratch,
      repackScratch,
      dsdFormat(2822400),
      frames,
      channels,
      frameBytes,
      physWidthBytes,
      [](PcmBlock& block) {
        assert(block.frames == 4);
        assert(block.byteSize == 8);
        block.data[0] = 0x10;
        block.data[1] = 0x20;
        block.data[2] = 0x11;
        block.data[3] = 0x21;
        return size_t{2};
      });

  assert(result.renderedDsdByteFrames == 2);
  assert(result.writeData == repackScratch.data());
  assert(result.writeByteSize == frames * frameBytes);
  const std::vector<uint8_t> expected = {
      0x10, 0x11, 0x20, 0x21,
      0x69, 0x69, 0x69, 0x69,
  };
  assert(repackScratch == expected);
}

void testAlsaDsdRenderHelperSkipsRepackForMonoWideDsd() {
  std::vector<uint8_t> typedScratch(1, 0x11);
  std::vector<uint8_t> repackScratch(4, 0x22);
  const size_t frames = 2;
  const int channels = 1;
  const int physWidthBytes = 2;
  const size_t frameBytes = static_cast<size_t>(channels * physWidthBytes);

  const auto result = alsa::renderDsdPeriodWithTailSilenceAndRepack(
      typedScratch,
      repackScratch,
      dsdFormat(2822400, channels),
      frames,
      channels,
      frameBytes,
      physWidthBytes,
      [](PcmBlock& block) {
        if (block.frames != 4 || block.byteSize != 4) std::abort();
        const uint8_t bytes[] = {0x10, 0x11, 0x12, 0x13};
        std::memcpy(block.data, bytes, sizeof(bytes));
        return block.frames;
      });

  if (result.renderedDsdByteFrames != 4) std::abort();
  if (result.writeData != typedScratch.data()) std::abort();
  if (result.writeByteSize != frames * frameBytes) std::abort();
  if ((typedScratch != std::vector<uint8_t>{0x10, 0x11, 0x12, 0x13})) std::abort();
  if ((repackScratch != std::vector<uint8_t>{0x22, 0x22, 0x22, 0x22})) std::abort();
}

void testAlsaPcmPackHelperWritesTypedScratchWithoutPerSampleFormatBranch() {
  std::vector<uint8_t> scratch(16, 0xee);
  const std::vector<float> input = {-1.0f, 0.5f, 0.25f, 2.0f};

  const size_t bytesPerFrame = alsa::packFloatScratchToPcmScratch(
      input.data(),
      2,
      2,
      AudioSampleFormat::Int24In32Interleaved,
      scratch);

  assert(bytesPerFrame == 8);
  const std::vector<uint8_t> expectedInt24In32 = {
      0x00, 0x00, 0x00, 0x80,
      0x00, 0x00, 0x00, 0x40,
      0x00, 0x00, 0x00, 0x20,
      0x00, 0xff, 0xff, 0x7f,
  };
  assert(scratch == expectedInt24In32);

  const float floatInput[] = {-2.0f, 0.25f};
  const size_t floatBytesPerFrame = alsa::packFloatScratchToPcmScratch(
      floatInput,
      1,
      2,
      AudioSampleFormat::Float32Interleaved,
      scratch);

  assert(floatBytesPerFrame == 8);
  assert(scratch.size() == 8);
  const float* packed = reinterpret_cast<const float*>(scratch.data());
  assert(packed[0] == -1.0f);
  assert(packed[1] == 0.25f);
}

}  // namespace


void testAlsaFloatStartRejectsNativeDsdMode() {
  const std::filesystem::path testFilePath(__FILE__);
  const std::filesystem::path sourcePath = testFilePath.parent_path().parent_path() / "output" / "alsa" / "AlsaBackend.cpp";
  const std::string source = readTextFile(sourcePath);
  const std::string body = extractFunctionBody(source, "bool AlsaBackend::start(RenderCallback callback, OutputEventCallback eventCallback, std::string* error)");
  assert(body.find("impl_->dsdMode") != std::string::npos);
  assert(body.find("typed render path") != std::string::npos);
}

int main() {
  testAlsaRenderLoopsUseNoResizeHelpers();
  testAlsaRenderLoopsDoNotBlockOnBackendMutex();
  testAlsaFloatStartRejectsNativeDsdMode();
  testAlsaRenderLoopsQueueRecoveryOffRenderThread();
  testAlsaStartRejectsRepeatedStartBeforeLaunchingThread();
  testAlsaRepeatedStartReturnsFalseWithoutRelaunchingThread();
  testAlsaOpenNegotiatesPcm();
  testAlsaDefaultBufferUsesEightPeriods();
  testAlsaFormatFallback();
  testAlsaXrunRecovery();
  testAlsaSuspendRecovery();
  testAlsaHwDevicePathKind();
  testAlsaDsd64SelectsU8();
  testAlsaDsd256SelectsU16Le();
  testAlsaDsd512SelectsU32Le();
  testAlsaNativeDsdRuntimeFactsCandidateAtOpen();
  testAlsaNativeDsdRuntimeFactsProvenAfterWritei();
  testAlsaNativeDsdOutputInfoReflectsRuntimeProof();
  testAlsaDsdBypassesFloat();
  testAlsaDsdSilenceIs0x69();
  testAlsaFloatRenderHelperZerosOnlyUnrenderedTail();
  testAlsaFloatRenderHelperDoesNotPreclearFullRender();
  testAlsaFloatRenderHelperZerosAllWithoutCallback();
  testAlsaDsdRepackPrepareSilencesPaddingWithoutClearingSourceSlots();
  testAlsaDsdSilenceScratchSkipsRewriteWhenAlreadySilent();
  testAlsaDsdRenderHelperReusesScratchAndRepackBuffers();
  testAlsaDsdRenderHelperSkipsRepackForMonoWideDsd();
  testAlsaPcmPackHelperWritesTypedScratchWithoutPerSampleFormatBranch();
  return 0;
}
