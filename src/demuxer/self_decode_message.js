import { readBuffer, mergeBuffer } from '../utils';

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

let sps = new Uint8Array();
let pps = new Uint8Array();

export default function self_decode_message(flv, event) {
    const {debug} = flv
    const message = event.data;
    switch (message.type) {
        case 'flvHeader':
            this.header = message.data;
            flv.emit('flvHeader', this.header);
            debug.log('flv-header', this.header);
            break;
        case 'scripMeta':
            this.scripMeta = message.data;
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