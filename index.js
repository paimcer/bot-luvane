const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require("fs");

// Diretório para salvar a sessão
const SESSION_DIR = "/data/whatsapp-session";

// Cria o diretório se não existir
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR);
}

// Variável para controlar o estado do bot (ativo/pausado globalmente)
let isBotActive = true;

// --- Definição das Respostas e Botões (Estilo Luvane) ---
const respostas = {
    "btn_vendas": "🛍️ Na *Luvane* você encontra:\n- Cosméticos naturais\n- Sabonetes artesanais\n- Kits de autocuidado\n- Presentes criativos 🌿",
    "btn_kits": "🎁 Temos kits especiais com muito carinho 💖\nConfira no catálogo ou peça um kit personalizado!",
    "btn_produtos": "📦 Veja nosso catálogo completo aqui:\n👉 [adicione o link do seu catálogo aqui]", // Substituir pelo link real
    "btn_comprar_info": "💳 Você pode comprar pelo WhatsApp mesmo!\nAceitamos *PIX*, cartão e boleto. Me diga o que você deseja!",
    "btn_falar_atendente": "📲 Um atendente vai te responder em instantes 💬\nVocê também pode escrever sua dúvida!",
    "btn_frete": "🚛 Me envie seu *CEP* e calculo o frete pra você rapidinho!",
    "btn_comprar_reservar": "📝 Me diga o nome do produto ou kit que deseja comprar ou reservar. Vamos finalizar sua compra juntas! 💌"
};

const menuButtons = [
    { buttonId: "btn_vendas", buttonText: { displayText: "1️⃣ O que vendemos" }, type: 1 },
    { buttonId: "btn_kits", buttonText: { displayText: "2️⃣ Kits promocionais" }, type: 1 },
    { buttonId: "btn_produtos", buttonText: { displayText: "3️⃣ Produtos disponíveis" }, type: 1 },
    { buttonId: "btn_comprar_info", buttonText: { displayText: "4️⃣ Como comprar" }, type: 1 },
    { buttonId: "btn_falar_atendente", buttonText: { displayText: "5️⃣ Falar com a gente" }, type: 1 },
    { buttonId: "btn_frete", buttonText: { displayText: "6️⃣ Calcular frete" }, type: 1 },
    { buttonId: "btn_comprar_reservar", buttonText: { displayText: "7️⃣ Comprar ou reservar" }, type: 1 },
];

const menuMessage = {
    text: "🌸 *Bem-vinda à Luvane!* 🌟\nComo podemos te ajudar hoje?",
    footer: "✨ Menu Principal - Clique em uma opção:",
    buttons: menuButtons,
    headerType: 1,
};
// --- Fim da Definição --- 

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Usando Baileys v${version.join(".")}, é a última versão: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true,
        auth: state,
        browser: Browsers.macOS("Desktop"),
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("QR Code recebido, escaneie com seu WhatsApp:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Conexão fechada devido a ", lastDisconnect.error, ", reconectando: ", shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === "open") {
            console.log("Conexão aberta!");
        }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const senderName = msg.pushName;
        const isFromMe = msg.key.fromMe;

        let incomingMessageText = "";
        let selectedButtonId = null;

        if (msg.message.conversation) {
            incomingMessageText = msg.message.conversation;
        } else if (msg.message.extendedTextMessage) {
            incomingMessageText = msg.message.extendedTextMessage.text;
        } else if (msg.message.imageMessage) {
            incomingMessageText = msg.message.imageMessage.caption;
        } else if (msg.message.videoMessage) {
            incomingMessageText = msg.message.videoMessage.caption;
        } else if (msg.message.templateButtonReplyMessage) {
            selectedButtonId = msg.message.templateButtonReplyMessage.selectedId;
            incomingMessageText = msg.message.templateButtonReplyMessage.selectedDisplayText;
            console.log(`Botão clicado! ID: ${selectedButtonId}, Texto: ${incomingMessageText}`);
        }

        const lowerCaseMessage = incomingMessageText?.toLowerCase() || "";

        // --- Lógica de Pausa/Retomada Global ---
        if (isFromMe) {
            if (lowerCaseMessage === "/pausar") {
                if (isBotActive) {
                    isBotActive = false;
                    await sock.sendMessage(sender, { text: "🤖 Bot pausado globalmente. Envie /retomar para reativar." });
                    console.log("Bot pausado manualmente pelo dono.");
                } else {
                    await sock.sendMessage(sender, { text: "🤖 Bot já está pausado." });
                }
                return;
            } else if (lowerCaseMessage === "/retomar") {
                if (!isBotActive) {
                    isBotActive = true;
                    await sock.sendMessage(sender, { text: "🤖 Bot retomado globalmente." });
                    console.log("Bot retomado manualmente pelo dono.");
                } else {
                    await sock.sendMessage(sender, { text: "🤖 Bot já está ativo." });
                }
                return;
            }
        }

        // Se o bot estiver pausado, ignora mensagens (exceto comandos de retomada)
        if (!isBotActive) return;

        // Ignora mensagens do próprio bot (que não sejam comandos)
        if (isFromMe) return;

        console.log(`Mensagem recebida de ${senderName} (${sender}): "${lowerCaseMessage}" ${selectedButtonId ? `(ID Botão: ${selectedButtonId})` : ''}`);

        // --- Lógica de Resposta e Botões (Estilo Luvane) ---
        // Envia o menu se receber 'oi', 'olá' ou '/menu'
        if (lowerCaseMessage === "oi" || lowerCaseMessage === "ola" || lowerCaseMessage === "olá" || lowerCaseMessage === "/menu" || lowerCaseMessage === "!start") {
            await sock.sendMessage(sender, menuMessage);
            console.log("Menu Luvane enviado.");
        }
        // Responde ao clique no botão usando o ID
        else if (selectedButtonId && respostas[selectedButtonId]) {
            await sock.sendMessage(sender, { text: respostas[selectedButtonId] });
            // Se for o botão de falar com atendente, pode adicionar uma notificação interna
            if (selectedButtonId === "btn_falar_atendente") {
                console.log(`*** ALERTA: ${senderName} (${sender}) solicitou falar com atendente! ***`);
                // Aqui você pode adicionar código para notificar o atendente real (ex: enviar msg para outro número, API, etc.)
            }
        }
        // Adicione aqui outras lógicas se precisar responder a texto livre
        // else if (lowerCaseMessage === 'outra coisa') { ... }

    });

    return sock;
}

connectToWhatsApp().catch((err) => console.log("Erro inesperado ao conectar: " + err));

