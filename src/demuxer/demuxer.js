class FlvPlayerError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FlvPlayerError';
    }
}

const debug = {
    warn: (condition, ...args) => {
        if (!condition) {
            console.warn(...args);
        }
    },
    error: (condition, msg) => {
        if (!condition) {
            throw new FlvPlayerError(msg);
        }
    },
};

function mergeBuffer(...buffers) {
    const Cons = buffers[0].constructor;
    return buffers.reduce((pre, val) => {
        const merge = new Cons((pre.byteLength | 0) + (val.byteLength | 0));
        merge.set(pre, 0);
        merge.set(val, pre.byteLength | 0);
        return merge;
    }, new Cons());
}

function readBufferSum(array, uint = true) {
    return array.reduce((totle, num, index) => totle + (uint ? num : num - 128) * 256 ** (array.length - index - 1), 0);
}

function readString(array) {
    return String.fromCharCode.call(String, ...array);
}

function readBuffer(buffer) {
    let index = 0;
    function readFn(length) {
        const tempUint8 = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
            tempUint8[i] = buffer[index];
            index += 1;
        }
        readFn.index = index;
        return tempUint8;
    }
    readFn.index = 0;
    return readFn;
}

function readDouble(array) {
    const view = new DataView(new ArrayBuffer(array.length));
    array.forEach((b, i) => {
        view.setUint8(i, b);
    });
    return view.getFloat64(0);
}

function readBoolean(array) {
    return array[0] !== 0;
}

let index = 0;
let header = null;
let uint8 = new Uint8Array();
let scripMeta = null;
let AudioSpecificConfig = null;
let AVCDecoderConfigurationRecord = null;
const nalStart = new Uint8Array([0x00, 0x00, 0x00, 0x01]);

function readable(length) {
    return uint8.length - index >= length;
}

function read(length) {
    const tempUint8 = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
        tempUint8[i] = uint8[index];
        index += 1;
    }
    return tempUint8;
}

function demuxerScripTag(tag) {
    const readScripTag = readBuffer(tag.body);
    const amf1 = Object.create(null);
    const amf2 = Object.create(null);

    amf1.type = readScripTag(1)[0];
    debug.error(amf1.type === 2, `AMF: [amf1] type expect 2, but got ${amf1.type}`);
    amf1.size = readBufferSum(readScripTag(2));
    amf1.string = readString(readScripTag(amf1.size));

    amf2.type = readScripTag(1)[0];
    debug.error(amf2.type === 8 || amf2.type === 3, `AMF: [amf2] type expect 8 or 3, but got ${amf2.type}`);
    amf2.size = readBufferSum(readScripTag(4));
    amf2.metaData = Object.create(null);

    function getValue(type) {
        let value = null;
        if (type !== undefined) {
            switch (type) {
                case 0:
                    value = readDouble(readScripTag(8));
                    break;
                case 1:
                    value = readBoolean(readScripTag(1));
                    break;
                case 2: {
                    const valueLength = readBufferSum(readScripTag(2));
                    value = readString(readScripTag(valueLength));
                    break;
                }
                case 3: {
                    value = Object.create(null);
                    let lastType = -1;
                    while (lastType !== 9) {
                        const nameLength = readBufferSum(readScripTag(2));
                        const name = readString(readScripTag(nameLength));
                        const itemType = readScripTag(1)[0];
                        if (name) {
                            value[name] = getValue(itemType);
                        }
                        lastType = itemType;
                    }
                    break;
                }
                case 5:
                    value = null;
                    break;
                case 6:
                    value = undefined;
                    break;
                case 7:
                    value = `Reference #${readScripTag.index}`;
                    readScripTag(2);
                    break;
                case 8: {
                    value = Object.create(null);
                    let lastType = -1;
                    while (lastType !== 9) {
                        const nameLength = readBufferSum(readScripTag(2));
                        const name = readString(readScripTag(nameLength));
                        const itemType = readScripTag(1)[0];
                        if (name) {
                            value[name] = getValue(itemType);
                        }
                        lastType = itemType;
                    }
                    break;
                }
                case 10: {
                    const valueLength = readBufferSum(readScripTag(4));
                    value = [];
                    for (let i = 0; i < valueLength; i += 1) {
                        const itemType = readScripTag(1)[0];
                        value.push(getValue(itemType));
                    }
                    break;
                }
                case 11:
                    value = readDouble(readScripTag(2));
                    break;
                case 12: {
                    const valueLength = readBufferSum(readScripTag(4));
                    value = readString(readScripTag(valueLength));
                    break;
                }
                default:
                    debug.error(false, `AMF: Unknown metaData type: ${type}`);
                    break;
            }
        }
        return value;
    }

    while (readScripTag.index < tag.body.length) {
        const nameLength = readBufferSum(readScripTag(2));
        const name = readString(readScripTag(nameLength));
        const type = readScripTag(1)[0];
        if (name) {
            amf2.metaData[name] = getValue(type);
        }
    }

    debug.warn(readScripTag.index === tag.body.length, '[AMF] Seems to be incompletely parsed');
    debug.warn(amf2.size === Object.keys(amf2.metaData).length, '[AMF] [amf2] length does not match');

    scripMeta = { amf1, amf2 };
    postMessage({
        type: 'scripMeta',
        data: scripMeta,
    });
}

function demuxerVideoTag(tag) {
    debug.error(tag.body.length > 1, 'Invalid video packet');
    const videoHeader = {
        frameType: (tag.body[0] & 0xf0) >> 4,
        codecID: tag.body[0] & 0x0f,
    };
    debug.error(videoHeader.codecID === 7, `[videoTrack] Unsupported codec in video frame: ${videoHeader.codecID}`);
    const packet = tag.body.slice(1, 5);
    debug.error(packet.length >= 4, '[H264] Invalid AVC packet, missing AVCPacketType or/and CompositionTime');
    const view = new DataView(packet.buffer);
    const AVCPacketType = view.getUint8(0);
    const CompositionTime = ((view.getUint32(0) & 0x00ffffff) << 8) >> 8;
    const pts = CompositionTime + tag.timestamp;
    const packetData = tag.body.subarray(5);

    if (AVCPacketType === 0) {
        debug.warn(!AVCDecoderConfigurationRecord, '[h264] Find another one AVCDecoderConfigurationRecord');
        debug.error(packetData.length >= 7, '[H264] AVCDecoderConfigurationRecord parse length is not enough');
        const readDcr = readBuffer(packetData);
        const result = {};
        result.configurationVersion = readDcr(1)[0];
        debug.error(
            result.configurationVersion === 1,
            `[H264] Invalid configurationVersion: ${result.configurationVersion}`,
        );
        result.AVCProfileIndication = readDcr(1)[0];
        debug.error(
            result.AVCProfileIndication !== 0,
            `[H264] Invalid AVCProfileIndication: ${result.AVCProfileIndication}`,
        );
        result.profile_compatibility = readDcr(1)[0];
        result.AVCLevelIndication = readDcr(1)[0];
        result.lengthSizeMinusOne = (readDcr(1)[0] & 3) + 1;
        debug.error(
            result.lengthSizeMinusOne === 4 || result.lengthSizeMinusOne !== 3,
            `[H264] Invalid lengthSizeMinusOne: ${result.lengthSizeMinusOne}`,
        );
        result.numOfSequenceParameterSets = readDcr(1)[0] & 31;
        debug.error(
            result.numOfSequenceParameterSets !== 0,
            `[H264] Invalid numOfSequenceParameterSets: ${result.numOfSequenceParameterSets}`,
        );
        debug.warn(
            result.numOfSequenceParameterSets === 1,
            `[H264] Strange numOfSequenceParameterSets: ${result.numOfSequenceParameterSets}`,
        );

        // let sps_data=[];
        for (let i = 0; i < result.numOfSequenceParameterSets; i += 1) {
            result.sequenceParameterSetLength = readBufferSum(readDcr(2));
            if (result.sequenceParameterSetLength > 0) {
                const SPS = readDcr(result.sequenceParameterSetLength);
                // sps_data.push(mergeBuffer(nalStart, SPS))
                postMessage({
                    type: 'videoData',
                    data: mergeBuffer(nalStart, SPS),
                });
            }
        }
        result.numOfPictureParameterSets = readDcr(1)[0];
        debug.error(
            result.numOfPictureParameterSets !== 0,
            `[H264] Invalid numOfPictureParameterSets: ${result.numOfPictureParameterSets}`,
        );
        debug.warn(
            result.numOfPictureParameterSets === 1,
            `[H264] Strange numOfPictureParameterSets: ${result.numOfPictureParameterSets}`,
        );
        let pps_data=[];
        for (let i = 0; i < result.numOfPictureParameterSets; i += 1) {
            result.pictureParameterSetLength = readBufferSum(readDcr(2));
            if (result.pictureParameterSetLength > 0) {
                const PPS = readDcr(result.pictureParameterSetLength);
                // pps_data.push(mergeBuffer(nalStart, PPS))
                postMessage({
                    type: 'videoData',
                    data: mergeBuffer(nalStart, PPS),
                });
            }
        }
        AVCDecoderConfigurationRecord = result;
        postMessage({
            type: 'AVCDecoderConfigurationRecord',
            data: result,
            // pps: pps_data,
            // sps_data: sps_data
        });
    } else if (AVCPacketType === 1) {
        const { lengthSizeMinusOne } = AVCDecoderConfigurationRecord;
        const readVideo = readBuffer(packetData);
        while (readVideo.index < packetData.length) {
            const length = readBufferSum(readVideo(lengthSizeMinusOne));
            postMessage({
                type: 'videoData',
                data: mergeBuffer(nalStart, readVideo(length)),
                timestamp: pts,
            });
        }
    } else {
        debug.error(AVCPacketType === 2, `[H264] Invalid video packet type ${AVCPacketType}`);
    }
}

function demuxerAudioTag(tag) {
    debug.error(tag.body.length > 1, 'Invalid audio packet');
    const audioHeader = {
        soundFormat: (tag.body[0] & 0xf0) >> 4,
        soundRate: (tag.body[0] & 0x0c) >> 2,
        soundSize: (tag.body[0] & 0x02) >> 1,
        soundType: (tag.body[0] & 0x01) >> 0,
    };
    debug.error(audioHeader.soundFormat === 10, `[audioTrack] unsupported audio format: ${audioHeader.soundFormat}`);
    const packet = tag.body.subarray(1);
    const packetType = packet[0];
    if (packetType === 0) {
        const packetData = packet.subarray(1);
        debug.warn(!AudioSpecificConfig, '[AAC] Find another one AudioSpecificConfig');
        debug.error(packetData.length >= 2, '[AAC] AudioSpecificConfig parse length is not enough');
        const result = {};
        result.audioObjectType = (packetData[0] & 0xf8) >> 3;
        result.samplingFrequencyIndex = ((packetData[0] & 7) << 1) + (((packetData[1] & 0x80) >> 7) & 1);
        result.channelConfiguration = (packetData[1] & 0x7f) >> 3;
        AudioSpecificConfig = result;
        postMessage({
            type: 'AudioSpecificConfig',
            data: result,
        });
    } else {
        const { audioObjectType, samplingFrequencyIndex, channelConfiguration } = AudioSpecificConfig;
        const ADTSLen = tag.dataSize - 2 + 7;
        const ADTSHeader = new Uint8Array(7);
        ADTSHeader[0] = 0xff;
        ADTSHeader[1] = 0xf0;
        ADTSHeader[1] |= 0 << 3;
        ADTSHeader[1] |= 0 << 1;
        ADTSHeader[1] |= 1;
        ADTSHeader[2] = (audioObjectType - 1) << 6;
        ADTSHeader[2] |= (samplingFrequencyIndex & 0x0f) << 2;
        ADTSHeader[2] |= 0 << 1;
        ADTSHeader[2] |= (channelConfiguration & 0x04) >> 2;
        ADTSHeader[3] = (channelConfiguration & 0x03) << 6;
        ADTSHeader[3] |= 0 << 5;
        ADTSHeader[3] |= 0 << 4;
        ADTSHeader[3] |= 0 << 3;
        ADTSHeader[3] |= 0 << 2;
        ADTSHeader[3] |= (ADTSLen & 0x1800) >> 11;
        ADTSHeader[4] = (ADTSLen & 0x7f8) >> 3;
        ADTSHeader[5] = (ADTSLen & 0x7) << 5;
        ADTSHeader[5] |= 0x1f;
        ADTSHeader[6] = 0xfc;
        const ADTSBody = tag.body.subarray(2);
        postMessage({
            type: 'audioData',
            data: mergeBuffer(ADTSHeader, ADTSBody),
            timestamp: tag.timestamp,
        });
    }
}

onmessage = event => {
    uint8 = mergeBuffer(uint8, event.data);
    if (!header && readable(13)) {
        header = Object.create(null);
        header.signature = readString(read(3));
        header.version = read(1)[0];
        debug.error(header.signature === 'FLV' && header.version === 1, 'FLV header not found');
        header.flags = read(1)[0];
        const hasAudio = (header.flags & 4) >>> 2 !== 0;
        const hasVideo = (header.flags & 1) !== 0;
        debug.warn(hasVideo, '[FLV header] flags not found video');
        debug.warn(hasAudio, '[FLV header] flags not found audio');
        header.headersize = readBufferSum(read(4));
        const prevTagSize = readBufferSum(read(4));
        debug.error(prevTagSize === 0, `PrevTagSize0 should be equal to 0, but got ${prevTagSize}`);
        postMessage({
            type: 'flvHeader',
            data: header,
        });
    }

    while (index < uint8.length) {
        const tag = Object.create(null);
        const restIndex = index;

        if (readable(11)) {
            tag.tagType = read(1)[0];
            tag.dataSize = readBufferSum(read(3));
            const ts2 = read(1)[0];
            const ts1 = read(1)[0];
            const ts0 = read(1)[0];
            const ts3 = read(1)[0];
            tag.timestamp = ts0 | (ts1 << 8) | (ts2 << 16) | (ts3 << 24);
            tag.streamID = readBufferSum(read(3));
            debug.error(tag.streamID === 0, `streamID should be equal to 0, but got ${tag.streamID}`);
        } else {
            index = 0;
            uint8 = uint8.subarray(restIndex);
            return;
        }

        if (readable(tag.dataSize + 4)) {
            tag.body = read(tag.dataSize);
            const prevTagSize = readBufferSum(read(4));
            debug.error(prevTagSize === tag.dataSize + 11, `Invalid PrevTagSize: ${prevTagSize}`);
        } else {
            index = 0;
            uint8 = uint8.subarray(restIndex);
            return;
        }

        switch (tag.tagType) {
            case 18:
                demuxerScripTag(tag);
                break;
            case 9:
                demuxerVideoTag(tag);
                break;
            case 8:
                demuxerAudioTag(tag);
                break;
            default:
                debug.error(false, `unknown tag type: ${tag.tagType}`);
                break;
        }
    }

    index = 0;
    uint8 = new Uint8Array();
};
