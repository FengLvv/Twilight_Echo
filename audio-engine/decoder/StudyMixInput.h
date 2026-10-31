#pragma once
#include "SeekableInput.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <vector>

namespace twilight::audio {
// All disk IO/mixing occurs on FFmpeg's decode worker. A byte position maps to
// ONE common frame position in every stem, including after arbitrary seeks.
class StudyMixInput final : public SeekableInput {
  struct Stem { std::ifstream file; std::string path; uint64_t offset = 0; float gain = 0; };
  std::vector<Stem> stems_;
  std::array<uint8_t, 80> header_{};
  uint64_t frames_ = 0;
  std::atomic<bool> cancelled_{false};
  static uint32_t u32(const uint8_t* p) {
    return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
  }
  void put32(int at, uint32_t value) { for (int i=0;i<4;++i) header_[at+i]=uint8_t(value>>(8*i)); }
  void put64(int at, uint64_t value) { for (int i=0;i<8;++i) header_[at+i]=uint8_t(value>>(8*i)); }
 public:
  explicit StudyMixInput(const std::string& manifest) {
    std::ifstream input(std::filesystem::u8path(manifest), std::ios::binary);
    std::string magic, path;
    std::getline(input, magic);
    if (!magic.empty() && magic.back()=='\r') magic.pop_back();
    unsigned rate = 0, count = 0;
    input >> rate >> frames_ >> count;
    if (magic != "TEMIX1" || rate != 44100 || count == 0 || count > 11 ||
        frames_ == 0 || frames_ > uint64_t(44100)*60*60*4) throw std::runtime_error("Invalid study mix");
    for (unsigned i=0;i<count;++i) {
      Stem stem;
      input >> stem.gain;
      input.ignore(std::numeric_limits<std::streamsize>::max(), '\n');
      std::getline(input, path);
      if (!path.empty() && path.back()=='\r') path.pop_back();
      if (!input || path.empty() || path.size()>32768 || !std::isfinite(stem.gain) ||
          stem.gain<0 || stem.gain>4) throw std::runtime_error("Invalid study stem");
      stem.path = path;
      stem.file.open(std::filesystem::u8path(path), std::ios::binary);
      std::array<uint8_t, 12> head{};
      stem.file.read(reinterpret_cast<char*>(head.data()), head.size());
      if (std::memcmp(head.data(), "RIFF", 4) || std::memcmp(head.data()+8, "WAVE", 4))
        throw std::runtime_error("Study stem must be float WAV");
      bool format = false;
      for (int chunks=0; chunks<64 && stem.file; ++chunks) {
        std::array<uint8_t, 8> chunk{};
        stem.file.read(reinterpret_cast<char*>(chunk.data()), chunk.size());
        auto length = u32(chunk.data()+4);
        auto offset = uint64_t(stem.file.tellg());
        if (!std::memcmp(chunk.data(), "fmt ", 4)) {
          std::array<uint8_t, 40> fmt{};
          if (length<16) throw std::runtime_error("Invalid WAV fmt");
          stem.file.read(reinterpret_cast<char*>(fmt.data()), std::min<size_t>(fmt.size(),length));
          const bool float32=(fmt[0]==3 && fmt[1]==0) ||
            (length>=40 && fmt[0]==0xfe && fmt[1]==0xff && u32(fmt.data()+24)==3);
          format = float32 && fmt[2]==2 && fmt[3]==0 && u32(fmt.data()+4)==44100 &&
                   fmt[12]==8 && fmt[13]==0 && fmt[14]==32 && fmt[15]==0;
        }
        if (!std::memcmp(chunk.data(), "data", 4)) {
          if (!format || length<uint64_t(frames_)*8) throw std::runtime_error("Misaligned study stem");
          stem.offset=offset; break;
        }
        stem.file.seekg(static_cast<std::streamoff>(offset+length+(length&1)));
      }
      if (!stem.offset) throw std::runtime_error("Missing WAV samples");
      stems_.push_back(std::move(stem));
    }
    // RF64 avoids overflow for long pieces; FFmpeg sees ordinary float PCM.
    std::memcpy(header_.data(), "RF64", 4); put32(4, 0xffffffff);
    std::memcpy(header_.data()+8, "WAVEds64", 8); put32(16, 28);
    put64(20, frames_*8+72); put64(28, frames_*8); put64(36, frames_);
    std::memcpy(header_.data()+48, "fmt ", 4); put32(52, 16);
    header_[56]=3; header_[58]=2; put32(60, 44100); put32(64, 44100*8);
    header_[68]=8; header_[70]=32;
    std::memcpy(header_.data()+72, "data", 4); put32(76, 0xffffffff);
  }
  int64_t size() override { return int64_t(80+frames_*8); }
  std::vector<std::string> paths() const { std::vector<std::string> out; for(const auto& stem:stems_)out.push_back(stem.path); return out; }
  std::vector<float> gains() const { std::vector<float> out; for(const auto& stem:stems_)out.push_back(stem.gain); return out; }
  void cancel() override { cancelled_.store(true, std::memory_order_relaxed); }
  int readAt(int64_t position, uint8_t* bytes, int count) override {
    if (cancelled_.load(std::memory_order_relaxed) || position<0 || count<0) return -1;
    if (position>=size()) return 0;
    count=int(std::min<int64_t>(count,size()-position));
    int copied=0;
    if (position<80) {
      copied=std::min(count,80-int(position));
      std::memcpy(bytes,header_.data()+position,copied); position+=copied;
    }
    while (copied<count) {
      const uint64_t offset=uint64_t(position-80), frame=offset/8;
      const unsigned skip=unsigned(offset%8);
      const size_t frames=std::min<uint64_t>(4096,std::min<uint64_t>(frames_-frame,(count-copied+skip+7)/8));
      std::vector<float> mixed(frames*2,0), scratch(frames*2);
      for (auto& stem:stems_) {
        if (stem.gain==0) continue;
        stem.file.clear(); stem.file.seekg(std::streamoff(stem.offset+frame*8));
        stem.file.read(reinterpret_cast<char*>(scratch.data()),std::streamsize(frames*8));
        if (stem.file.gcount()!=std::streamsize(frames*8)) return -1;
        for (size_t j=0;j<mixed.size();++j) mixed[j]+=scratch[j]*stem.gain;
      }
      int available=std::min<int>(int(frames*8)-skip,count-copied);
      std::memcpy(bytes+copied,reinterpret_cast<uint8_t*>(mixed.data())+skip,available);
      position+=available; copied+=available;
      if (cancelled_.load(std::memory_order_relaxed)) return -1;
    }
    return copied;
  }
};
} // namespace twilight::audio
