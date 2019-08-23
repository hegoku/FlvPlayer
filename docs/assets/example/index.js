var assets = 'https://zhw2590582.github.io/assets-cdn';
var flv = new FlvPlayer({
    container: '.flvplayer-app',
    poster: assets + '/image/weathering-with-you-poster.jpg',
    url: assets + '/video/weathering-with-you-H264(Baseline@L52)-AAC.flv',
    // url: assets + '/video/weathering-with-you-H264(High@L52)-AAC.flv',
    // url: assets + '/video/weathering-with-you-H264(Main@L52)-AAC.flv',
    decoder: './uncompiled/flvplayer-decoder-baseline.js',
    // decoder: './uncompiled/flvplayer-decoder-multiple.js',
    debug: true,
    live: false,
    loop: true,
    hotkey: true,
    autoPlay: false,
    hasAudio: true,
    volume: 7,
    width: 640,
    height: 360,
});
