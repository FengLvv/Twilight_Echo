cmake_minimum_required(VERSION 3.25)

project(TwilightAudioAndroidSdk VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Force Android-appropriate Twilight Audio Engine build flags before adding audio-engine
set(TAE_ENABLE_OBOE ON CACHE BOOL "Enable Android Oboe/AAudio output backend" FORCE)
set(TAE_BUILD_NAPI OFF CACHE BOOL "Build the Node-API bridge" FORCE)
set(TAE_BUILD_TESTS OFF CACHE BOOL "Build Twilight Audio Engine tests" FORCE)
set(TAE_ENABLE_WASAPI OFF CACHE BOOL "Enable the Windows WASAPI backend" FORCE)
set(TAE_ENABLE_ASIO OFF CACHE BOOL "Enable the Windows x64 ASIO compatibility backend" FORCE)
set(TAE_ENABLE_COREAUDIO OFF CACHE BOOL "Enable the macOS CoreAudio backend" FORCE)
set(TAE_ENABLE_ALSA OFF CACHE BOOL "Enable the Linux ALSA backend" FORCE)
set(TAE_ENABLE_IOS_AUDIOUNIT OFF CACHE BOOL "Enable iOS AudioUnit output backend" FORCE)
set(TAE_ENABLE_MINIAUDIO OFF CACHE BOOL "Enable the miniaudio Shared/default PCM provider PoC" FORCE)

set(TAE_AUDIO_ENGINE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../audio-engine")
if(ANDROID)
  set(TAE_FFMPEG_ROOT "" CACHE PATH "Root of the per-ABI Android FFmpeg 7.1.2 builds")
  set(_ffmpeg "${TAE_FFMPEG_ROOT}/${ANDROID_ABI}")
  if(NOT EXISTS "${_ffmpeg}/include/libavformat/avformat.h")
    message(FATAL_ERROR "Android FFmpeg is required. Run sdk/android/ffmpeg/build-ffmpeg.sh <ffmpegRoot> ${ANDROID_ABI}, then pass -DTAE_FFMPEG_ROOT=<ffmpegRoot>.")
  endif()
  set(FFMPEG_LIBRARIES)
  foreach(component avformat avcodec swresample avutil)
    set(_library "${_ffmpeg}/lib/lib${component}.so")
    if(NOT EXISTS "${_library}")
      message(FATAL_ERROR "Missing Android FFmpeg library: ${_library}")
    endif()
    add_library(tae_ffmpeg_${component} SHARED IMPORTED)
    set_target_properties(tae_ffmpeg_${component} PROPERTIES IMPORTED_LOCATION "${_library}")
    list(APPEND FFMPEG_LIBRARIES tae_ffmpeg_${component})
  endforeach()
  set(FFMPEG_INCLUDE_DIRS "${_ffmpeg}/include")
  set(FFMPEG_FOUND TRUE)
  add_link_options("-Wl,-z,max-page-size=16384")
endif()
if(NOT TARGET twilight_audio_engine)
  add_subdirectory("${TAE_AUDIO_ENGINE_DIR}" "${CMAKE_CURRENT_BINARY_DIR}/audio-engine")
endif()

add_library(twilight_audio_jni SHARED
  jni/twilight_audio_jni.cpp
)

target_include_directories(twilight_audio_jni
  PRIVATE
    "${TAE_AUDIO_ENGINE_DIR}/include"
)

target_link_libraries(twilight_audio_jni
  PRIVATE
    twilight_audio_engine
)

if(ANDROID)
  target_link_libraries(twilight_audio_jni
    PRIVATE
      aaudio
      log
  )
else()
  find_package(JNI QUIET)
  if(JNI_FOUND)
    target_include_directories(twilight_audio_jni PRIVATE ${JNI_INCLUDE_DIRS})
  endif()
endif()

set_target_properties(twilight_audio_jni PROPERTIES
  OUTPUT_NAME "twilight_audio_jni"
)
