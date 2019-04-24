import * as net from 'net';
import * as crypto from 'crypto';
import * as consts from './const/mysql';

class OkMessage {
    constructor(
        public message: string = '',
        public affectedRows: number = 0,
        public insertId: number = 0,
        public warningCount: number = 0) {

    }
}

class ErrorMessage {
    constructor(
        public message: string = '',
        public errno: number = 0,
        public sqlState: string = '') {
    }
}

class FauxMySqlServer {
    socket: net.Socket;
    banner: string = "MyServer/1.0";
    sequence: number = -1;
    packetCount: number = 0;

    constructor(socket: net.Socket) {
        this.socket = socket;
        this.socket.on('data', (data) => this.readPacket(data));
    }

    handleData(data: Buffer) {

    }

    readPacket(buf: Buffer) {
        var offset = 0;
        console.log('receive packet')

        while (true) {
            var _data = buf.slice(offset);
            if (_data.length < 4) return _data;

            var packetLength = _data.readUIntLE(0, 3);
            if (_data.length < packetLength + 4) return _data;

            this.sequence = _data.readUIntLE(3, 1) + 1;
            offset += packetLength + 4;
            var packet = _data.slice(4, packetLength + 4);

            this.helloPacketHandler(packet);
            this.packetCount++;
        }
    }

    helloPacketHandler(packet: Buffer) {
        //## Reading Client Hello...

        console.log('receive hello')
        // http://dev.mysql.com/doc/internals/en/the-packet-header.html

        if (packet.length == 0) return this.sendError(new ErrorMessage("Zero length hello packet"));

        var ptr = 0;

        var clientFlags = packet.slice(ptr, ptr + 4);
        ptr += 4;

        var maxPacketSize = packet.slice(ptr, ptr + 4);
        ptr += 4;

        let clientCharset = packet.readUInt8(ptr);
        ptr++;

        var filler1 = packet.slice(ptr, ptr + 23);
        ptr += 23;

        var usernameEnd = packet.indexOf(0, ptr);
        var username = packet.toString('ascii', ptr, usernameEnd);

        console.log(username)

        ptr = usernameEnd + 1;

        var scrambleBuff = void 0;

        var scrambleLength = packet.readUInt8(ptr);
        ptr++;

        if (scrambleLength > 0) {
            let scramble = packet.slice(ptr, ptr + scrambleLength);
            ptr += scrambleLength;
        }

        var database = void 0;

        var databaseEnd = packet.indexOf(0, ptr);
        if (databaseEnd >= 0) {
            database = packet.toString('ascii', ptr, databaseEnd);
        }

        this.sendServerHello()
        this.sendOK(new OkMessage('OK'));
    }

    normalPacketHandler(packet: Buffer) {
        if (packet == null) throw "Empty packet";
        return this.onCommand(
            packet.readUInt8(0),
            packet.length > 1 ? packet.slice(1) : null
        );
    }

    onCommand(command: number, extra: Buffer) {
        switch (command) {
            case consts.COM_QUERY:
                break;
            case consts.COM_PING:
                this.sendOK(new OkMessage('OK'));
                break;
            case null:
            case undefined:
            case consts.COM_QUIT:
                console.log("Disconnecting");
                break;
            default:
                console.log("Unknown Command: " + command);
                this.sendError(new ErrorMessage('"Unknown Command"'));
                break;
        }
    }

    sendServerHello() {
        var payload = Buffer.alloc(128);
        var pos = 4;
        pos = payload.writeUInt8(10, pos); // Protocol version

        pos += payload.write(this.banner, pos);
        pos = payload.writeUInt8(0, pos);

        pos = payload.writeUInt32LE(process.pid, pos);

        const salt = crypto.randomBytes(20);

        pos += salt.copy(payload, pos, 0, 8);
        pos = payload.writeUInt8(0, pos);

        pos = payload.writeUInt16LE(
            consts.CLIENT_LONG_PASSWORD |
            consts.CLIENT_CONNECT_WITH_DB |
            consts.CLIENT_PROTOCOL_41 |
            consts.CLIENT_SECURE_CONNECTION, pos);

        pos = payload.writeUInt8(0x21, pos); // latin1

        pos = payload.writeUInt16LE(consts.SERVER_STATUS_AUTOCOMMIT, pos);
        payload.fill(0, pos, pos + 13);
        pos += 13;

        pos += salt.copy(payload, pos, 8);
        pos = payload.writeUInt8(0, pos);

        this.sequence = 0;

        this.appendHeader(payload, pos);
        this.sendPacket(payload.slice(0, pos))
    }

    sendOK(ok: OkMessage) {
        var data = Buffer.alloc(ok.message.length + 64);
        var len = 4;
        len = data.writeUInt8(0, len);
        len = this.writeLengthCodedBinary(data, len, ok.affectedRows);
        len = this.writeLengthCodedBinary(data, len, ok.insertId);
        len = data.writeUInt16LE(consts.SERVER_STATUS_AUTOCOMMIT, len);
        len = data.writeUInt16LE(ok.warningCount, len);
        len = this.writeLengthCodedString(data, len, ok.message);

        this.appendHeader(data, len);
        this.sendPacket(data.slice(0, len));
    }

    sendError(error: ErrorMessage) {
        var data = Buffer.alloc(error.message.length + 64);
        var len = 4;
        len = data.writeUInt8(0xFF, len);
        len = data.writeUInt16LE(error.errno, len);
        len += data.write("#", len);
        len += data.write(error.sqlState, len, 5);
        len += data.write(error.message, len);
        len = data.writeUInt8(0, len);

        this.appendHeader(data, len);
        this.sendPacket(data.slice(0, len));
    }

    appendHeader(data: Buffer, len: number) {
        data.writeUIntLE(len - 4, 0, 3);
        data.writeUInt8(this.sequence++ % 256, 3);
    }

    sendPacket(msg: any) {
        return this.socket.write(msg)
    }

    writeLengthCodedString(buf: Buffer, pos: number, str: string) {
        if (str == null) return buf.writeUInt8(0, pos);
        buf.writeUInt8(253, pos);
        buf.writeUIntLE(str.length, pos + 1, 3);
        buf.write(str, pos + 4);
        return pos + str.length + 4;
    }

    writeLengthCodedBinary(buf: Buffer, pos: number, number: number) {
        if (number == null) {
            return buf.writeUInt8(251, pos);
        } else if (number < 251) {
            return buf.writeUInt8(number, pos);
        } else if (number < 0x10000) {
            buf.writeUInt8(252, pos);
            buf.writeUInt16LE(number, pos + 1);
            return pos + 3;
        } else if (number < 0x1000000) {
            buf.writeUInt8(253, pos);
            buf.writeUIntLE(number, pos + 1, 3);
            return pos + 4;
        } else {
            buf.writeUInt8(254, pos);
            buf.writeUIntLE(number, pos + 1, 8);
            return pos + 9;
        }
    }
}

net.createServer((socket) => {
    let server = new FauxMySqlServer(socket)
}).listen(3306, () => {
    console.log('Server started');
})


