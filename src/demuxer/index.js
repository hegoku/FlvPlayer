import { getNowTime, calculationRate } from '../utils';

export default class Demuxer {
    constructor(flv, demuxWorkerOnMessageHandler) {
        const { options, debug } = flv;
        this.header = null;
        this.streaming = false;
        this.demuxed = false;
        this.videoDataSize = 0;
        this.audioDataSize = 0;
        this.videoDataLength = 0;
        this.audioDataLength = 0;
        this.streamStartTime = 0;
        this.streamEndTime = 0;
        this.scripMeta = null;
        this.AudioSpecificConfig = null;
        this.AVCDecoderConfigurationRecord = null;
        this.demuxWorker = new Worker('./demuxer.js');

        this._onDemouWorkerOnMessage = demuxWorkerOnMessageHandler;

        this.demuxRate = calculationRate(rate => {
            flv.emit('demuxRate', rate);
        });

        flv.on('destroy', () => {
            this.demuxWorker.terminate();
            this.demuxWorker = null;
        });

        flv.on('streamStart', () => {
            this.streaming = true;
            this.streamStartTime = getNowTime();
            if (typeof options.url === 'string') {
                const url = Object.assign(document.createElement('a'), { href: options.url }).href;
                debug.log('stream-url', url);
            }
        });

        flv.on('streaming', uint8 => {
            this.demuxWorker.postMessage(uint8);
        });

        flv.on('streamEnd', uint8 => {
            this.streaming = false;
            this.streamEndTime = getNowTime();

            if (uint8) {
                this.index = 0;
                this.demuxWorker.postMessage(uint8);
            }

            debug.log('stream-time', `${this.streamEndTime - this.streamStartTime} ms`);
            this.demuxed = true;
            flv.emit('demuxDone');
            debug.log('demux-done');
        });

        this.demuxWorker.onmessage = event => {
            if (this._onDemouWorkerOnMessage) {
                this._onDemouWorkerOnMessage.call(this, flv, event)
            }
        }
        
        // let sps = new Uint8Array();
        // let pps = new Uint8Array();
        // this.demuxWorker.onmessage = event => {
        //     const message = event.data;
        //     switch (message.type) {
        //         case 'flvHeader':
        //             this.header = message.data;
        //             flv.emit('flvHeader', this.header);
        //             debug.log('flv-header', this.header);
        //             break;
        //         case 'scripMeta':
        //             this.scripMeta = message.data;
        //             flv.emit('scripMeta', this.scripMeta);
        //             debug.log('scrip-meta', this.scripMeta);
        //             break;
        //         case 'AVCDecoderConfigurationRecord':
        //             this.AVCDecoderConfigurationRecord = message.data;
        //             for (i=0; i<message.data.sps_data.length; i++) {
        //                 sps=message.data.sps_data[i]
        //             }
        //             for (i=0; i<message.data.pps_data.length; i++) {
        //                 pps=message.data.pps_data[i]
        //             }
        //             flv.emit('AVCDecoderConfigurationRecord', this.AVCDecoderConfigurationRecord);
        //             debug.log('AVCDecoderConfigurationRecord', this.AVCDecoderConfigurationRecord);
        //             debug.log('AVC-codecs', getAVCCodecs(this.AVCDecoderConfigurationRecord));
        //             debug.log('AVC-profile', getProfileString(this.AVCDecoderConfigurationRecord.AVCProfileIndication));
        //             debug.log('AVC-level', getLevelString(this.AVCDecoderConfigurationRecord.AVCLevelIndication));
        //             break;
        //         case 'AudioSpecificConfig':
        //             this.AudioSpecificConfig = message.data;
        //             flv.emit('AudioSpecificConfig', this.AudioSpecificConfig);
        //             debug.log('AudioSpecificConfig', this.AudioSpecificConfig);
        //             debug.log('AAC-codecs', getAACCodecs(this.AudioSpecificConfig));
        //             break;
        //         case 'videoData': {
        //             this.demuxRate(1);
        //             this.videoDataLength += 1;
        //             this.videoDataSize += message.data.byteLength;
        //             const readNalu = readBuffer(message.data);
        //             readNalu(4);
        //             const naluType = readNalu(1)[0] & 31;
        //             switch (naluType) {
        //                 case 1:
        //                 case 5: {
        //                     flv.emit('videoData', mergeBuffer(sps, pps, message.data), message.timestamp);
        //                     break;
        //                 }
        //                 case 7:
        //                     sps = message.data;
        //                     break;
        //                 case 8:
        //                     pps = message.data;
        //                     break;
        //                 default:
        //                     break;
        //             }
        //             break;
        //         }
        //         case 'audioData':
        //             this.audioDataLength += 1;
        //             this.audioDataSize += message.data.byteLength;
        //             flv.emit('audioData', message.data, message.timestamp);
        //             break;
        //         default:
        //             break;
        //     }
        // };
    }
}
