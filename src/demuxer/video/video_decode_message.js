import { readBuffer, mergeBuffer } from '../../utils';
import MediaInfo from './media-info'

function getProfileString(profileIdc) {
    switch (profileIdc) {
        case 66:
            return 'Baseline';
        case 77:
            return 'Main';
        case 88:
            return 'Extended';
        case 100:
            return 'High';
        case 110:
            return 'High10';
        case 122:
            return 'High422';
        case 244:
            return 'High444';
        default:
            return 'Unknown';
    }
}

function getLevelString(levelIdc) {
    return (levelIdc / 10).toFixed(1);
}

function getAVCCodecs(record) {
    const AVCProfileIndication = record.AVCProfileIndication.toString(16);
    const profileCompatibility = record.profile_compatibility.toString(16);
    const AVCLevelIndication = record.AVCLevelIndication.toString(16);
    return `avc1.${AVCProfileIndication}${profileCompatibility}${AVCLevelIndication}`;
}

function getAACCodecs({ audioObjectType }) {
    const objectTypeId = ((audioObjectType - 1) << 6).toString(16);
    return `mp4a.${objectTypeId}.${audioObjectType}`;
}

function _parseKeyframesIndex(keyframes) {
    let times = [];
    let filepositions = [];

    // ignore first keyframe which is actually AVC Sequence Header (AVCDecoderConfigurationRecord)
    for (let i = 1; i < keyframes.times.length; i++) {
        let time = this._timestampBase + Math.floor(keyframes.times[i] * 1000);
        times.push(time);
        filepositions.push(keyframes.filepositions[i]);
    }

    return {
        times: times,
        filepositions: filepositions
    };
}

let _hasAudio = false
let _hasVideo = false
let _mediaInfo = new MediaInfo()

let sps = new Uint8Array();
let pps = new Uint8Array();

export default function video_decode_message(flv, event) {
    const {debug} = flv
    const message = event.data;
    switch (message.type) {
        case 'flvHeader':
            this.header = message.data;
            _hasAudio = hasAudio = (this.header.flags & 4) >>> 2 !== 0;
            _mediaInfo.hasAudio = _hasAudio;
            _hasVideo = hasVideo = (this.header.flags & 1) !== 0;
            _mediaInfo.hasVideo = _hasVideo;
            flv.emit('flvHeader', this.header);
            debug.log('flv-header', this.header);
            break;
        case 'scripMeta':
            this.scripMeta = message.data;
            let amf2 = this.scripMeta.amf2
            if (typeof amf2.audiodatarate === 'number') {  // audiodatarate
                _mediaInfo.audioDataRate = onMetaData.audiodatarate;
            }
            if (typeof amf2.videodatarate === 'number') {  // videodatarate
                _mediaInfo.videoDataRate = onMetaData.videodatarate;
            }
            if (typeof amf2.width === 'number') {  // width
                _mediaInfo.width = onMetaData.width;
            }
            if (typeof amf2.height === 'number') {  // height
                _mediaInfo.height = onMetaData.height;
            }
            if (typeof amf2.duration === 'number') {  // duration
                if (!this._durationOverrided) {
                    let duration = Math.floor(amf2.duration * this._timescale);
                    this._duration = duration;
                    _mediaInfo.duration = duration;
                }
            } else {
                _mediaInfo.duration = 0;
            }
            if (typeof amf2.framerate === 'number') {  // framerate
                let fps_num = Math.floor(amf2.framerate * 1000);
                if (fps_num > 0) {
                    let fps = fps_num / 1000;
                    this._referenceFrameRate.fixed = true;
                    this._referenceFrameRate.fps = fps;
                    this._referenceFrameRate.fps_num = fps_num;
                    this._referenceFrameRate.fps_den = 1000;
                    _mediaInfo.fps = fps;
                }
            }
            if (typeof amf2.keyframes === 'object') {  // keyframes
                _mediaInfo.hasKeyframesIndex = true;
                let keyframes = amf2.keyframes;
                _mediaInfo.keyframesIndex = _parseKeyframesIndex(keyframes);
                amf2.keyframes = null;  // keyframes has been extracted, remove it
            } else {
                _mediaInfo.hasKeyframesIndex = false;
            }
            flv.emit('scripMeta', this.scripMeta);
            debug.log('scrip-meta', this.scripMeta);
            break;
        case 'AVCDecoderConfigurationRecord':
            this.AVCDecoderConfigurationRecord = message.data;
            flv.emit('AVCDecoderConfigurationRecord', this.AVCDecoderConfigurationRecord);
            debug.log('AVCDecoderConfigurationRecord', this.AVCDecoderConfigurationRecord);
            debug.log('AVC-codecs', getAVCCodecs(this.AVCDecoderConfigurationRecord));
            debug.log('AVC-profile', getProfileString(this.AVCDecoderConfigurationRecord.AVCProfileIndication));
            debug.log('AVC-level', getLevelString(this.AVCDecoderConfigurationRecord.AVCLevelIndication));
            break;
        case 'AudioSpecificConfig':
            this.AudioSpecificConfig = message.data;
            flv.emit('AudioSpecificConfig', this.AudioSpecificConfig);
            debug.log('AudioSpecificConfig', this.AudioSpecificConfig);
            debug.log('AAC-codecs', getAACCodecs(this.AudioSpecificConfig));
            break;
        case 'videoData': {
            this.demuxRate(1);
            this.videoDataLength += 1;
            this.videoDataSize += message.data.byteLength;
            const readNalu = readBuffer(message.data);
            readNalu(4);
            const naluType = readNalu(1)[0] & 31;
            switch (naluType) {
                case 1:
                case 5: {
                    flv.emit('videoData', mergeBuffer(sps, pps, message.data), message.timestamp);
                    break;
                }
                case 7:
                    sps = message.data;
                    break;
                case 8:
                    pps = message.data;
                    break;
                default:
                    break;
            }
            break;
        }
        case 'audioData':
            this.audioDataLength += 1;
            this.audioDataSize += message.data.byteLength;
            flv.emit('audioData', message.data, message.timestamp);
            break;
        default:
            break;
    }
};