import assert from 'node:assert/strict'
import test from 'node:test'
import { isStudyCredit } from './lyricCredits.ts'

test('observed multilingual, bilingual and spaced credits share one header policy', () => {
  for (const value of [
    '作詞：大森祥子',
    '編曲：小森茂生',
    '制 作 人：叶圣涛',
    '作词 Lyrics by：阿福',
    '混音/母带工程师 Mixing Engineer/Mastering：某某',
    '编曲/钢琴Music Arranged &Piano by: 某某',
    '管乐录音师：某某',
    '录音棚Recording Studio：某棚',
    '人声录音棚Ａ：某棚',
    'Production Credits:',
    'Recording Engineer - 某某',
    'Recorded by 홍지상 at The Chocolab',
    'Mixed at Henson Recording Studios',
    'Recorded at Noisematch (Miami, U.S.), late 2016',
    'Auteurs: Zaz',
    '【未经授权不得翻唱或使用】'
  ])
    assert(isStudyCredit(value), value)
})
test('performer cues and ordinary lyric sentences do not become credit headers', () => {
  for (const value of [
    '男：我爱你',
    '女：别离开',
    '合唱：我们一起唱',
    '念白：等你回来',
    'Chorus: We will rise',
    '[Verse 1: Lil Wayne]',
    '慕寒：我在等你',
    '策划逃脱 这也有错',
    '制作人说：再唱一次',
    'Written by the wind I follow you',
    'Recorded at dawn, I remembered you',
    '和声像风吹过',
    'Bass by the window'
  ]) {
    assert(!isStudyCredit(value), value)
  }
})
