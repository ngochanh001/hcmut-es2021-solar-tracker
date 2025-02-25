import express from 'express';
import expressStaticGzip from 'express-static-gzip';
import http, { IncomingMessage } from 'http';
import { Socket } from 'net';
import url from 'url';
import WebSocket from 'ws';

const app = express();
app.use(expressStaticGzip('public', {
    enableBrotli: true,
    orderPreference: ['br', 'gzip'],
}));
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

enum AppEvent {
    UpdateConfig = "UPDATE_CONFIG",
    UpdateState = "UPDATE_STATE",
}

enum ControlMode {
    Automatic = "AUTOMATIC",
    Manual = "MANUAL",
}

interface ControlConfig {
    controlMode?: ControlMode,
    manualOrientation?: Orientation,
}

interface SystemState {
    timestamp: number,
    motorOrientation: Orientation,
    platformOrientation: Orientation,
    solarPanelOrientation: Orientation,
    solarPanelVoltage: number,
    sunOrientation: Orientation,
}

interface Orientation {
    azimuth: number,
    inclination: number,
}

let config = {
    controlMode: ControlMode.Automatic,
    manualOrientation: {
        azimuth: 0.0,
        inclination: 0.0,
    } as Orientation
} as ControlConfig;

function throwException(message: string): never {
    throw new Error(message);
}

server.on('upgrade', (request: IncomingMessage, socket: Socket, buffer: Buffer) => {
    const pathname = url.parse(request.url ?? throwException('Request does not have an URL!')).pathname;

    if (pathname == '/ws') {
        wss.handleUpgrade(request, socket, buffer, ws => wss.emit('connection', ws, request));
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const address = request.socket.remoteAddress ?? "unkown address";

    console.log(`A client from ${address} connected.`);

    ws.on('close', (code, reason) => console.log(`A client from ${address} disconnected with code ${code}, reason: ${reason}.`));

    ws.on('message', data => {
        // console.log(`Received:\n${data}`);

        let request: {
            event: AppEvent,
            payload?: {} | []
        } = JSON.parse(data as string);

        wss.emit(request.event, ws, request.payload);
    });

    ws.on(AppEvent.UpdateConfig, () => {
        ws.send(JSON.stringify({
            event: AppEvent.UpdateConfig,
            payload: config,
        }));
    });

    ws.on(AppEvent.UpdateState, (new_state: SystemState) => {
        ws.send(JSON.stringify({
            event: AppEvent.UpdateState,
            payload: new_state,
        }))
    });

    ws.emit(AppEvent.UpdateConfig);
});

wss.on(AppEvent.UpdateConfig, (ws: WebSocket, new_config: ControlConfig) => {
    config.controlMode = new_config.controlMode ?? config.controlMode;
    config.manualOrientation = new_config.manualOrientation ?? config.manualOrientation;

    for (let client of wss.clients) {
        if (client == ws) continue;

        client.emit(AppEvent.UpdateConfig);
    }
});

wss.on(AppEvent.UpdateState, (ws: WebSocket, new_state: SystemState) => {
    for (let client of wss.clients) {
        if (client == ws) continue;

        client.emit(AppEvent.UpdateState, new_state);
    }
});

wss.on('FAKE_DATA', (ws: WebSocket) => {
    let fakeDataInterval = setInterval(() => {
        let timestamp = Date.now();
        let solarPanelVoltage = 5 * Math.cos(timestamp / 1000 * 3 % 360 * 2 * Math.PI / 360) + 5;
        let solarPanelOrientation: Orientation = {
            azimuth: 0,
            inclination: 0,
        };

        if (config.controlMode == ControlMode.Manual) {
            solarPanelOrientation = config.manualOrientation ?? solarPanelOrientation;
        } else {
            solarPanelOrientation.azimuth = timestamp / 1000 * 30 % 360;
            solarPanelOrientation.inclination = 90 * (0.5 * Math.sin(solarPanelOrientation.azimuth * 2 * Math.PI / 360) + 0.5);
        }

        ws.emit(AppEvent.UpdateState, {
            timestamp,
            solarPanelVoltage,
            solarPanelOrientation,
        } as SystemState);
    }, 100);

    ws.on('close', () => clearInterval(fakeDataInterval));
});

const port = parseInt(process.env['PORT'] ?? '8080');

server.listen(port, () => console.log(`Server is listening to port ${port}`));
