# Twilight Echo Android Native Audio SDK (`sdk/android`)

This directory provides the Android NDK / CMake build entry and JNI bridge (`libtwilight_audio_jni.so`) that connects the Kotlin Android client (`com.twilightecho.android.nativeintegration.TwilightAudioEngineJni`) to the C++20 `twilight_audio_engine` core and the Android `OboeOutputBackend` (backed by Android NDK `<aaudio/AAudio.h>`).

## Architecture Overview

1. **Native Core (`audio-engine`)**:
   - Compiled with `TAE_ENABLE_OBOE=ON`, `TAE_BUILD_NAPI=OFF`, `TAE_BUILD_TESTS=OFF`.
   - `OboeOutputBackend` uses Android NDK AAudio (`AAudioStreamBuilder`) in `AAUDIO_PERFORMANCE_MODE_LOW_LATENCY` with `AAUDIO_FORMAT_PCM_FLOAT`.
   - Supports configurable `AAUDIO_SHARING_MODE_EXCLUSIVE` with automatic fallback to `AAUDIO_SHARING_MODE_SHARED`.
   - Real-time data callback (`onAudioReady`) renders PCM frames directly from `AudioPipeline` without blocking I/O or UI thread hops.
   - Hardware parameters (`sampleRate`, `channelCount`, `sharingMode`, `framesPerBurst`, `bufferSizeInFrames`, `deviceId`) are queried from the opened `AAudioStream` and reported honestly in `OutputInfo` (`supportsOutputPerfect` and `outputPerfect` are `false` in shared mode, and `true` only when exclusive + source-exact + unresampled).
   - Stream disconnect/error events (`AAudioStream_errorCallback`) are forwarded through `OutputEventCallback` to the engine clock/recovery loop.

2. **JNI Bridge (`jni/twilight_audio_jni.cpp`)**:
   - Exposes JNI functions for `com.twilightecho.android.nativeintegration.TwilightAudioEngineJni`.
   - Thread-safe event listener dispatch via `JavaVM*` (`AttachCurrentThread` / `DetachCurrentThread`) and `GlobalRef` management.
   - `nativeDestroyEngine` detaches `TAE_SetEventCallback(engine, nullptr, nullptr)` and releases the listener `GlobalRef` before calling `TAE_DestroyEngine(engine)`, preventing dangling callbacks during teardown.
   - Snapshot JSON getters (`nativeGetPlaybackInfoJson`, `nativeGetQueueStateJson`, `nativeGetEngineCapabilitiesJson`, `nativeGetLastErrorJson`) use the two-step size-probe/fill protocol of the C ABI.

## Gradle `externalNativeBuild` Integration

Build Android FFmpeg first (NDK r27+, Bash, GNU make, curl and tar):

```bash
export ANDROID_NDK_HOME=/path/to/android-ndk
bash sdk/android/ffmpeg/build-ffmpeg.sh /path/to/ffmpeg-root
```

This builds LGPL-only FFmpeg 7.1.2 shared libraries for the four Android ABIs,
with audio decoders and 16 KiB ELF alignment. Native networking is disabled: an
engine-scoped `TAE_SetInputProvider` supplies authorized, cancellable random reads
on decode workers. `open` creates an independent stream; returning null retains
ordinary native file IO. The Android host uses independent content descriptors
for active and preloaded decoders. The provider is installed once before playback.
Use idempotent `TAE_SetPaused` for platform interruptions; `TAE_Pause` remains a toggle.

In `clients/android/app/build.gradle.kts` (or module `build.gradle.kts`):

```kotlin
android {
    defaultConfig {
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
        externalNativeBuild {
            cmake {
                arguments += listOf(
                    "-DANDROID_STL=c++_shared",
                    "-DTAE_ENABLE_OBOE=ON",
                    "-DTAE_FFMPEG_ROOT=/path/to/ffmpeg-root",
                    "-DTAE_BUILD_NAPI=OFF",
                    "-DTAE_BUILD_TESTS=OFF"
                )
            }
        }
    }
    externalNativeBuild {
        cmake {
            path = file("../../../sdk/android/CMakeLists.txt")
            version = "3.25.0+"
        }
    }
}
```
