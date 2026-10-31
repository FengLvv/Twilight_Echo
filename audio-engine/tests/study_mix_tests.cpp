#include "../decoder/StudyMixInput.h"
#include <cassert>
#include <iostream>

using twilight::audio::StudyMixInput;
static void wave(const std::filesystem::path& path,float value,int rate=44100) {
  std::array<uint8_t,44> head{};
  auto put=[&](int p,uint32_t x){for(int i=0;i<4;++i)head[p+i]=uint8_t(x>>(i*8));};
  std::memcpy(head.data(),"RIFF",4);put(4,36+800);std::memcpy(head.data()+8,"WAVEfmt ",8);put(16,16);
  head[20]=3;head[22]=2;put(24,rate);put(28,rate*8);head[32]=8;head[34]=32;std::memcpy(head.data()+36,"data",4);put(40,800);
  std::ofstream file(path,std::ios::binary);file.write(reinterpret_cast<char*>(head.data()),44);
  for(int i=0;i<200;++i)file.write(reinterpret_cast<char*>(&value),4);
}
int main(){
  const auto root=std::filesystem::temp_directory_path()/"twilight-study-mix-unit";
  std::filesystem::create_directories(root);
  const auto first=root/"first.wav",second=root/"second.wav",manifest=root/"mix.temix";
  wave(first,.25f);wave(second,.5f);
  {std::ofstream file(manifest);file<<"TEMIX1\n44100 100 2\n1\n"<<first.string()<<"\n0.5\n"<<second.string()<<"\n";}
  StudyMixInput input(manifest.string());assert(input.size()==880);
  std::array<uint8_t,19> bytes{};assert(input.readAt(0,bytes.data(),4)==4);assert(!std::memcmp(bytes.data(),"RF64",4));
  std::array<float,6> samples{};assert(input.readAt(80+17*8,reinterpret_cast<uint8_t*>(samples.data()),24)==24);
  for(auto v:samples)assert(v==.5f);
  // Unaligned byte reads and EOF must still refer to the exact same frame clock.
  float expected=.5f;std::array<uint8_t,4> packed{};std::memcpy(packed.data(),&expected,4);
  assert(input.readAt(81,bytes.data(),19)==19);for(int i=0;i<19;++i)assert(bytes[i]==packed[(i+1)%4]);
  assert(input.readAt(878,bytes.data(),19)==2);assert(input.readAt(880,bytes.data(),19)==0);
  input.cancel();assert(input.readAt(80,bytes.data(),4)==-1);
  wave(second,.5f,48000);bool rejected=false;try{StudyMixInput invalid(manifest.string());}catch(...){rejected=true;}assert(rejected);
  std::cout<<"Synchronized mixing, sample seeks, unaligned reads, EOF, cancellation and format guards passed\n";
}
