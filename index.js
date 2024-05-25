import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 12000 });

const clients = new Map(); // 클라이언트가 추가될 때 마다 해당 자료구조에 추가된다.
let gameState = false; // 3명이 모이면 게임이 시작한다.
let words = ['사과', '거짓말', '사과']; // 3명 중 1명은 다른 단어를 받게 된다.
let votes = []; // 투표 결과를 저장
let clientCounter = 1; // 클라이언트 ID를 부여하기 위한 카운터
let chatOrder = []; // 채팅의 순서
let currentChatIndex = 0; // 현재 순서를 확인
let chatCnt = 0; // 매 턴마다의 채팅 횟수
let totalCnt = 0; // 턴 수
let spectators = 0;  // 관전자 수를 관리하는 변수
let spectatorCounter = 1;  // 관전자 번호를 부여하기 위한 카운터

// 함수를 이용하여 메시지를 전체에게 전달
const broadcast = (data) => {
    const message = JSON.stringify(data); // 모든 메시지를 문자열화된 JSON 형태로 변환
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};

// 상태를 업데이트하고 전체에게 전송
const updateStatus = () => {
    const playerCount = Array.from(clients.values()).filter(client => client.isPlayer).length;
    broadcast({
        type: 'status',
        players: playerCount,
        spectators
    });
};

const startGame = () => {
    gameState = true;
    let RandomWords = words.sort(() => Math.random() - 0.5); // 단어를 랜덤으로 정렬한다.
    chatOrder = Array.from(clients.keys()).filter(id => clients.get(id).isPlayer).sort(() => Math.random() - 0.5); // 채팅 순서를 랜덤으로 설정
    currentChatIndex = 0; // 첫 번째 클라이언트부터 시작

    let i = 0;
    clients.forEach((client) => {
        if (client.isPlayer && client.readyState === WebSocket.OPEN) { // 접속한 클라이언트에게 랜덤으로 단어를 제공한다.
            client.send(JSON.stringify({ type: 'word', word: RandomWords[i++] }));
        }
    });

    broadcast({ type: 'chat', message: `GAME START!!!\nChating order: ${chatOrder.map(id => `Client ${id}`).join(', ')}` }); // 해당 문구가 클라이언트 채팅에서 보이지 않는 문제 발생
    broadcast({ type: 'chat', message: `It's now client ${chatOrder[currentChatIndex]}'s turn.` }); // 채팅 순서를 알려준다.
};

// 투표를 수행하고 결과를 채팅창에 보여준다.
const endGame = () => {
    gameState = false;
    let voteCounts = votes.reduce((acc, vote) => {
        acc[vote] = (acc[vote] || 0) + 1;
        return acc;
    }, {});
    let maxVotes = Math.max(...Object.values(voteCounts));
    let mostVoted = Object.keys(voteCounts).find(key => voteCounts[key] === maxVotes);
    let otherWordClientId = chatOrder[words.findIndex(word => word === '거짓말')];
    let correct = parseInt(mostVoted) === otherWordClientId;
    let result = `${mostVoted}`; // 다득표를 받은 클라이언트 아이디
    
    broadcast({ type: 'result', correct, votes: result });
    if (correct) broadcast({ type: 'chat', message: "Liar Lose!"}); // 지목된 사람이 라이어인 경우
    else broadcast({ type: 'chat', message: "Liar Win!"}); // 지목된 사람이 라이어가 아닌 경우

    console.log("Game ended!");

    clients.forEach((client) => { // 게임이 종료되면 웹소켓을 닫는다.
        if (client.readyState === WebSocket.OPEN) {
            client.close();
        }
    });
};

wss.on('connection', (ws) => {
    const clientId = clientCounter++;
    clients.set(clientId, ws);
    console.log(`${clientId} connected`);

    if (clients.size <= 3 && !gameState) {
        ws.isPlayer = true;  // 플레이어로 표시
    } else {
        ws.isPlayer = false;  // 관전자로 표시
        ws.spectatorNumber = spectatorCounter++;
        spectators++;
    }

    updateStatus(); // 상태 업데이트

    if (clients.size === 3 && !gameState) {
        startGame(); // 클라이언트 3명이 모이면 게임이 시작한다.
    }

    ws.on('message', (message) => {
        const parsedMessage = JSON.parse(message);
        console.log(`${clientId} : ${parsedMessage}`); // 사용자가 단어에 대한 설명을 채팅으로 보내면 이를 채팅창에 출력

        if (parsedMessage.type === 'spectatorMessage') {
            if (!ws.isPlayer) {
                broadcast({ type: 'spectatorMessage', message: `Spectator ${ws.spectatorNumber}: ${parsedMessage.message}` });
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Players cannot participate in spectator chat.' }));
            }
            return;
        }

        if (!gameState) { 
            ws.send(JSON.stringify({ type: 'error', message: 'Game not in progress.' }));
            return;
        }

        if (!ws.isPlayer) {
            ws.send(JSON.stringify({ type: 'error', message: 'Spectators cannot participate.' }));
            return;
        }

        if (clientId !== chatOrder[currentChatIndex]) { // 현재 차례가 아니면 메시지를 무시하고 클라이언트에게 알림
            ws.send(JSON.stringify({ type: 'error', message: 'Not your turn!' }));
            return;
        }
        
        chatCnt++; // 각 순서를 지키기 위한 변수

        if (totalCnt === 3) { // 모두 3번씩 설명을 진행하였을 때
            votes.push(parsedMessage.message);
            broadcast({ type: 'vote', message: `${clientId} : ${parsedMessage.message}` });

            if (votes.length === 3) { // 모든 클라이언트가 투표를 완료했을 때 endGame을 호출
                endGame();
            }
        }
        else { // 아직 횟수가 남은 경우 채팅을 출력
            broadcast({ type: 'chat', message: `${clientId} : ${parsedMessage.message}` }); 
        }

        currentChatIndex = (currentChatIndex + 1) % chatOrder.length; // 다음 차례로 넘어간다.
        broadcast({ type: 'chat', message: `It's now client ${chatOrder[currentChatIndex]}'s turn.` }); // 다음 채팅 순서를 알림

        if (chatCnt === 3 && totalCnt < 3) {
            chatCnt = 0;
            totalCnt++;
            if (totalCnt <= 3) { // 매 턴이 종료됨을 알림
                broadcast({ type: 'chat', message: `${totalCnt} Turn Over` });
            }
            if (totalCnt == 3) { // 3번의 채팅기회 이후 투표하라는 메세지를 전달
                broadcast({ type: 'chat', message: `Vote now!` });
            }
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        console.log(`${clientId} disconnected`);

        if (ws.isPlayer && gameState && clients.size < 3) {
            gameState = false;
            broadcast({ type: 'chat', message: "Game ended due to a client disconnecting." });
        }

        if (!ws.isPlayer) {
            spectators--;
        }

        updateStatus(); // 상태 업데이트
    });

    ws.on('error', ( error ) => {
        console.error(error);
    });
});

console.log('WebSocket server is running on ws://localhost:12000');
