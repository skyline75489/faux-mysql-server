import * as net from 'net';
import * as crypto from 'crypto';
import * as consts from './const/mysql';

class FauxMySqlServer {
    socket: net.Socket
    banner: string = "MyServer/1.0"
    sequence: number = -1

    constructor(socket: net.Socket) {
        this.socket = socket;
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

    appendHeader(data: Buffer, len: number) {
        data.writeUIntLE(len - 4, 0, 3);
        data.writeUInt8(this.sequence++ % 256, 3);        
    }
    sendPacket(msg: any) {
        return this.socket.write(msg)
    }
}

net.createServer((socket) => {
    let server = new FauxMySqlServer(socket)
}).listen(3306, () => { 
    console.log('Server started');
})


