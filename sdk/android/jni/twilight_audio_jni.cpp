#include "twilight_audio_engine.h"

#include <jni.h>

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#if defined(__ANDROID__)
#include <android/log.h>
#define TAE_JNI_LOGW(...) __android_log_print(ANDROID_LOG_WARN, "TwilightAudioJNI", __VA_ARGS__)
#else
#define TAE_JNI_LOGW(...) ((void)0)
#endif

namespace {

std::mutex g_vmMutex;
JavaVM* g_javaVm = nullptr;

void ensureJavaVm(JNIEnv* env) {
  if (!env) return;
  std::lock_guard lock(g_vmMutex);
  if (!g_javaVm) {
    env->GetJavaVM(&g_javaVm);
  }
}

JavaVM* getJavaVm() {
  std::lock_guard lock(g_vmMutex);
  return g_javaVm;
}

class ScopedJniEnv {
 public:
  explicit ScopedJniEnv(JavaVM* vm) : vm_(vm) {
    if (!vm_) return;
    const jint status = vm_->GetEnv(reinterpret_cast<void**>(&env_), JNI_VERSION_1_6);
    if (status == JNI_OK) {
      attached_ = false;
    } else if (status == JNI_EDETACHED) {
#if defined(__ANDROID__)
      if (vm_->AttachCurrentThread(&env_, nullptr) == JNI_OK) {
        attached_ = true;
      }
#else
      if (vm_->AttachCurrentThread(reinterpret_cast<void**>(&env_), nullptr) == JNI_OK) {
        attached_ = true;
      }
#endif
    }
  }

  ~ScopedJniEnv() {
    if (attached_ && vm_) {
      vm_->DetachCurrentThread();
    }
  }

  ScopedJniEnv(const ScopedJniEnv&) = delete;
  ScopedJniEnv& operator=(const ScopedJniEnv&) = delete;

  JNIEnv* get() const { return env_; }

 private:
  JavaVM* vm_ = nullptr;
  JNIEnv* env_ = nullptr;
  bool attached_ = false;
};

struct JniListenerContext {
  std::mutex mutex;
  jobject listenerGlobalRef = nullptr;
  jmethodID onEventMethod = nullptr;

  void clear(JNIEnv* env) {
    std::lock_guard lock(mutex);
    if (listenerGlobalRef && env) {
      env->DeleteGlobalRef(listenerGlobalRef);
    }
    listenerGlobalRef = nullptr;
    onEventMethod = nullptr;
  }

  void dispatch(const char* eventType, const char* payloadJson) {
    JavaVM* vm = getJavaVm();
    if (!vm) return;

    ScopedJniEnv scopedEnv(vm);
    JNIEnv* env = scopedEnv.get();
    if (!env) return;

    jobject localListener = nullptr;
    jmethodID methodId = nullptr;
    {
      std::lock_guard lock(mutex);
      if (!listenerGlobalRef || !onEventMethod) return;
      localListener = env->NewLocalRef(listenerGlobalRef);
      methodId = onEventMethod;
    }
    if (!localListener || !methodId) {
      if (localListener) env->DeleteLocalRef(localListener);
      return;
    }

    jstring jEventType = env->NewStringUTF(eventType ? eventType : "");
    jstring jPayloadJson = env->NewStringUTF(payloadJson ? payloadJson : "{}");
    if (jEventType && jPayloadJson) {
      env->CallVoidMethod(localListener, methodId, jEventType, jPayloadJson);
      if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
        TAE_JNI_LOGW("Exception thrown in Kotlin TwilightAudioEventListener.onEvent");
      }
    } else if (env->ExceptionCheck()) {
      env->ExceptionClear();
    }

    if (jEventType) env->DeleteLocalRef(jEventType);
    if (jPayloadJson) env->DeleteLocalRef(jPayloadJson);
    env->DeleteLocalRef(localListener);
  }
};

std::mutex g_contextsMutex;
std::unordered_map<TAE_EngineHandle, std::shared_ptr<JniListenerContext>> g_contexts;

TAE_EngineHandle toEngineHandle(jlong handle) {
  return reinterpret_cast<TAE_EngineHandle>(static_cast<uintptr_t>(handle));
}

jlong fromEngineHandle(TAE_EngineHandle engine) {
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(engine));
}

std::string jstringToUtf8(JNIEnv* env, jstring value) {
  if (!env || !value) return {};
  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (!chars) {
    if (env->ExceptionCheck()) env->ExceptionClear();
    return {};
  }
  const jsize len = env->GetStringUTFLength(value);
  std::string result(chars, static_cast<size_t>(len >= 0 ? len : 0));
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

jstring readEngineJson(
    JNIEnv* env,
    TAE_EngineHandle engine,
    TAE_Result (*getter)(TAE_EngineHandle, char*, size_t, size_t*),
    const char* fallbackJson = "{}") {
  if (!env) return nullptr;
  if (!engine || !getter) {
    return env->NewStringUTF(fallbackJson);
  }

  size_t required = 0;
  TAE_Result probeResult = getter(engine, nullptr, 0, &required);
  if (probeResult != TAE_RESULT_OK && probeResult != TAE_RESULT_INVALID_ARGUMENT) {
    return env->NewStringUTF(fallbackJson);
  }

  std::vector<char> buffer(required == 0 ? 1 : required, '\0');
  TAE_Result fillResult = TAE_RESULT_OK;
  for (int attempt = 0; attempt < 3; ++attempt) {
    fillResult = getter(engine, buffer.data(), buffer.size(), &required);
    if (fillResult == TAE_RESULT_OK) break;
    if (fillResult != TAE_RESULT_INVALID_ARGUMENT || required <= buffer.size()) break;
    buffer.assign(required, '\0');
  }

  if (fillResult != TAE_RESULT_OK) {
    return env->NewStringUTF(fallbackJson);
  }
  return env->NewStringUTF(buffer.data());
}

void nativeEventCallbackTrampoline(
    const char* eventType,
    const char* payloadJson,
    void* userData) {
  auto* rawContext = static_cast<JniListenerContext*>(userData);
  if (!rawContext) return;
  rawContext->dispatch(eventType, payloadJson);
}

jmethodID resolveListenerMethod(JNIEnv* env, jclass listenerClass) {
  if (!env || !listenerClass) return nullptr;
  jmethodID methodId = env->GetMethodID(
      listenerClass, "onEvent", "(Ljava/lang/String;Ljava/lang/String;)V");
  if (methodId) return methodId;
  if (env->ExceptionCheck()) env->ExceptionClear();

  methodId = env->GetMethodID(
      listenerClass, "onNativeEvent", "(Ljava/lang/String;Ljava/lang/String;)V");
  if (env->ExceptionCheck()) env->ExceptionClear();
  return methodId;
}

}  // namespace

extern "C" {

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
  {
    std::lock_guard lock(g_vmMutex);
    g_javaVm = vm;
  }
  JNIEnv* env = nullptr;
  if (!vm || vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
    return JNI_ERR;
  }
  return JNI_VERSION_1_6;
}

JNIEXPORT jlong JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeCreateEngine(
    JNIEnv* env,
    jobject /*thiz*/) {
  ensureJavaVm(env);
  TAE_EngineHandle engine = nullptr;
  const TAE_Result result = TAE_CreateEngine(&engine);
  if (result != TAE_RESULT_OK || !engine) {
    return 0L;
  }
  {
    std::lock_guard lock(g_contextsMutex);
    g_contexts[engine] = std::make_shared<JniListenerContext>();
  }
  return fromEngineHandle(engine);
}

JNIEXPORT void JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeDestroyEngine(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  if (!engine) return;

  // Clear engine callback first so the clock/worker threads cannot invoke a dangling listener.
  TAE_SetEventCallback(engine, nullptr, nullptr);

  std::shared_ptr<JniListenerContext> context;
  {
    std::lock_guard lock(g_contextsMutex);
    const auto it = g_contexts.find(engine);
    if (it != g_contexts.end()) {
      context = std::move(it->second);
      g_contexts.erase(it);
    }
  }
  if (context) {
    context->clear(env);
  }

  TAE_DestroyEngine(engine);
}

JNIEXPORT void JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetEventListener(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jobject listener) {
  ensureJavaVm(env);
  TAE_EngineHandle engine = toEngineHandle(handle);
  if (!engine || !env) return;

  // Detach callback while mutating the listener global reference.
  TAE_SetEventCallback(engine, nullptr, nullptr);

  std::shared_ptr<JniListenerContext> context;
  {
    std::lock_guard lock(g_contextsMutex);
    auto& slot = g_contexts[engine];
    if (!slot) {
      slot = std::make_shared<JniListenerContext>();
    }
    context = slot;
  }

  context->clear(env);

  if (!listener) {
    return;
  }

  jclass listenerClass = env->GetObjectClass(listener);
  jmethodID onEventMethod = resolveListenerMethod(env, listenerClass);
  if (listenerClass) {
    env->DeleteLocalRef(listenerClass);
  }
  if (!onEventMethod) {
    TAE_JNI_LOGW("TwilightAudioEventListener does not define onEvent(String, String)");
    return;
  }

  jobject globalRef = env->NewGlobalRef(listener);
  if (!globalRef) {
    return;
  }

  {
    std::lock_guard lock(context->mutex);
    context->listenerGlobalRef = globalRef;
    context->onEventMethod = onEventMethod;
  }

  TAE_SetEventCallback(engine, &nativeEventCallbackTrampoline, context.get());
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetStateEventsEnabled(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle,
    jboolean enabled) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_SetStateEventsEnabled(engine, enabled == JNI_TRUE ? 1 : 0));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativePlay(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring source,
    jdouble startTimeSeconds) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string sourceUtf8 = jstringToUtf8(env, source);
  return static_cast<jint>(TAE_Play(engine, sourceUtf8.c_str(), static_cast<double>(startTimeSeconds)));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativePause(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_Pause(engine));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeStop(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_Stop(engine));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSeek(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle,
    jdouble positionSeconds) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_Seek(engine, static_cast<double>(positionSeconds)));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetVolume(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle,
    jdouble volume) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_SetVolume(engine, static_cast<double>(volume)));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetPlaybackRate(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle,
    jdouble rate) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_SetPlaybackRate(engine, static_cast<double>(rate)));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetPlayMode(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring mode) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string modeUtf8 = jstringToUtf8(env, mode);
  return static_cast<jint>(TAE_SetPlayMode(engine, modeUtf8.c_str()));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeLoadQueue(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring queueJson,
    jint startIndex) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string queueUtf8 = jstringToUtf8(env, queueJson);
  return static_cast<jint>(TAE_LoadQueue(engine, queueUtf8.c_str(), static_cast<int>(startIndex)));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSelectQueueIndex(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle,
    jint index) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_SelectQueueIndex(engine, static_cast<int>(index)));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeNext(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_Next(engine));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativePrevious(
    JNIEnv* /*env*/,
    jobject /*thiz*/,
    jlong handle) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  return static_cast<jint>(TAE_Previous(engine));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetOutputConfig(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring outputConfigJson) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string jsonUtf8 = jstringToUtf8(env, outputConfigJson);
  return static_cast<jint>(TAE_SetOutputConfig(engine, jsonUtf8.c_str()));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetDspConfig(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring dspConfigJson) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string jsonUtf8 = jstringToUtf8(env, dspConfigJson);
  return static_cast<jint>(TAE_SetDspConfig(engine, jsonUtf8.c_str()));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetOutputDevice(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring deviceId) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string deviceUtf8 = jstringToUtf8(env, deviceId);
  return static_cast<jint>(TAE_SetOutputDevice(engine, deviceUtf8.c_str()));
}

JNIEXPORT jint JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeSetOutputBackend(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle,
    jstring backendId) {
  TAE_EngineHandle engine = toEngineHandle(handle);
  const std::string backendUtf8 = jstringToUtf8(env, backendId);
  return static_cast<jint>(TAE_SetOutputBackend(engine, backendUtf8.c_str()));
}

JNIEXPORT jstring JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeGetPlaybackInfoJson(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle) {
  return readEngineJson(env, toEngineHandle(handle), &TAE_GetPlaybackInfo, "{}");
}

JNIEXPORT jstring JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeGetQueueStateJson(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle) {
  return readEngineJson(env, toEngineHandle(handle), &TAE_GetQueueState, "{}");
}

JNIEXPORT jstring JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeGetEngineCapabilitiesJson(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle) {
  return readEngineJson(env, toEngineHandle(handle), &TAE_GetEngineCapabilities, "{}");
}

JNIEXPORT jstring JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeGetLastErrorJson(
    JNIEnv* env,
    jobject /*thiz*/,
    jlong handle) {
  return readEngineJson(
      env,
      toEngineHandle(handle),
      &TAE_GetLastError,
      "{\"hasError\":false,\"code\":\"TAE_RESULT_OK\",\"message\":\"\"}");
}

JNIEXPORT jstring JNICALL
Java_com_twilightecho_android_nativeintegration_TwilightAudioEngineJni_nativeGetVersion(
    JNIEnv* env,
    jobject /*thiz*/) {
  if (!env) return nullptr;
  const char* version = TAE_GetVersion();
  return env->NewStringUTF(version ? version : "0.1.0");
}

}  // extern "C"
