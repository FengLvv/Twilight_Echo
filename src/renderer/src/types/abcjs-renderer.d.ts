declare module 'abcjs/src/api/abc_tunebook_svg.js' {
  // Pinned renderer entry keeps the editor and audio synthesizer out of the lyrics window.
  const renderAbc: typeof import('abcjs').renderAbc
  export default renderAbc
}
