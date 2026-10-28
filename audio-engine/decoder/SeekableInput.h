#pragma once

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace twilight::audio {

// Host-owned bytes; invoked on decode/control workers, never the audio callback.
// Each factory invocation owns an independent cursor/cache and cancellation scope.
class SeekableInput {
 public:
  virtual ~SeekableInput() = default;
  virtual int64_t size() = 0;
  // Positive byte count, 0 at EOF, negative on failure.
  virtual int readAt(int64_t position, uint8_t* bytes, int count) = 0;
  // Thread-safe, nonblocking: unblocks an in-flight size/readAt. Not reversible.
  virtual void cancel() = 0;
};
using SeekableInputFactory = std::function<std::shared_ptr<SeekableInput>(const std::string&)>;

}  // namespace twilight::audio
