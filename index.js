const { Client: DiscordClient, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, EmbedBuilder } = require('discord.js');
const { Client: SelfClient } = require('discord.js-selfbot-v13');

const bot = new DiscordClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const userTokens = new Map();
const activeCleanups = new Map();
const CARGO_PERMITIDO = '1567550448389460008';

bot.on('clientReady', () => {
    console.log(`Bot do Painel conectado como: ${bot.user.tag}`);
});

bot.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.content === '!painel') {
        if (!message.member.roles.cache.has(CARGO_PERMITIDO)) {
            return message.reply({ content: 'Você não tem permissão para usar este painel.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('Painel de Controle de Limpeza (CL)')
            .setDescription('Clique em **Configurar Token** para salvar a sua chave ou em **Iniciar CL** para apagar as mensagens.')
            .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('btn_config_token')
                .setLabel('Configurar Token')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('btn_executar_cl')
                .setLabel('Iniciar CL')
                .setStyle(ButtonStyle.Danger)
        );

        await message.channel.send({
            embeds: [embed],
            components: [row]
        });
    }
});

bot.on('interactionCreate', async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith('cl_control_')) {
        const action = interaction.customId.replace('cl_control_', '');
        const cleanupData = activeCleanups.get(interaction.user.id);

        if (!cleanupData) {
            return interaction.reply({ content: 'Nenhum processo de limpeza ativo encontrado.', ephemeral: true });
        }

        if (action === 'parar') {
            cleanupData.paused = true;
            await interaction.update({ embeds: [new EmbedBuilder().setTitle('CL PAUSADO').setDescription('O processo foi pausado. Clique em Iniciar para continuar.').setColor(0xFEE75C)], components: [criarBotoesControle(true)] });
            return;
        }

        if (action === 'iniciar') {
            cleanupData.paused = false;
            await interaction.update({ embeds: [new EmbedBuilder().setTitle('CL A EXECUTAR').setDescription('A retomar a limpeza das mensagens...').setColor(0x57F287)], components: [criarBotoesControle(false)] });
            return;
        }

        if (action === 'cancelar') {
            cleanupData.cancelled = true;
            await interaction.update({ embeds: [new EmbedBuilder().setTitle('CL CANCELADO').setDescription('Processo cancelado pelo utilizador.').setColor(0xED4245)], components: [] });
            return;
        }
    }

    if (!interaction.guild || !interaction.member.roles.cache.has(CARGO_PERMITIDO)) {
        if (interaction.isRepliable()) {
            return interaction.reply({ content: 'Você não possui o cargo necessário para interagir com este painel.', ephemeral: true });
        }
        return;
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'btn_config_token') {
            const modal = new ModalBuilder()
                .setCustomId('modal_token')
                .setTitle('Configuração de Token');

            const tokenInput = new TextInputBuilder()
                .setCustomId('input_user_token')
                .setLabel('Cole o seu User Token:')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(tokenInput));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'btn_executar_cl') {
            const modal = new ModalBuilder()
                .setCustomId('modal_cl')
                .setTitle('Iniciar Limpeza de DM');

            const channelInput = new TextInputBuilder()
                .setCustomId('input_channel_id')
                .setLabel('ID do Canal/DM:')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
            await interaction.showModal(modal);
        }
    }

    if (interaction.type === InteractionType.ModalSubmit) {
        if (interaction.customId === 'modal_token') {
            const token = interaction.fields.getTextInputValue('input_user_token').trim();
            userTokens.set(interaction.user.id, token);
            await interaction.reply({ content: 'Token configurado com sucesso!', ephemeral: true });
        }

        if (interaction.customId === 'modal_cl') {
            const channelId = interaction.fields.getTextInputValue('input_channel_id').trim();
            const savedToken = userTokens.get(interaction.user.id);

            if (!savedToken) {
                await interaction.reply({ content: 'Nenhum token configurado. Clique primeiro em **Configurar Token**.', ephemeral: true });
                return;
            }

            await interaction.reply({ content: 'Painel de progresso enviado para a sua **DM**.', ephemeral: true });

            iniciarControloLimpezaDM(savedToken, channelId, interaction.user);
        }
    }
});

function criarBotoesControle(pausado) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('cl_control_iniciar')
            .setLabel('Iniciar')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!pausado),
        new ButtonBuilder()
            .setCustomId('cl_control_parar')
            .setLabel('Parar')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(pausado),
        new ButtonBuilder()
            .setCustomId('cl_control_cancelar')
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Danger)
    );
}

async function iniciarControloLimpezaDM(token, channelId, discordUser) {
    let dmChannel;
    try {
        dmChannel = await discordUser.createDM();
    } catch (err) {
        return;
    }

    const cleanupData = {
        cancelled: false,
        paused: true
    };
    activeCleanups.set(discordUser.id, cleanupData);

    const embedInicial = new EmbedBuilder()
        .setTitle('CL PAUSADO / PRONTO')
        .setDescription('Clique em **Iniciar** para começar a apagar as mensagens.')
        .setColor(0xFEE75C);

    const controlMessage = await dmChannel.send({
        embeds: [embedInicial],
        components: [criarBotoesControle(true)]
    });

    const selfClient = new SelfClient({
        checkUpdate: false
    });

    selfClient.on('ready', async () => {
        try {
            const channel = await selfClient.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                await dmChannel.send('Canal ou DM não encontrada ou ID inválido.');
                await selfClient.destroy();
                activeCleanups.delete(discordUser.id);
                return;
            }

            const loadingEmbed = new EmbedBuilder()
                .setTitle('A CALCULAR MENSAGENS')
                .setDescription('Buscando histórico...')
                .setColor(0x5865F2);
            await controlMessage.edit({ embeds: [loadingEmbed] });

            let todasMensagensDoUsuario = [];
            let lastId;

            while (true) {
                const options = { limit: 100 };
                if (lastId) options.before = lastId;

                const messages = await channel.messages.fetch(options).catch(() => null);
                if (!messages || messages.size === 0) break;

                const userMsgs = messages.filter(m => m.author && m.author.id === selfClient.user.id);
                todasMensagensDoUsuario.push(...userMsgs.values());

                lastId = messages.last().id;
                if (messages.size < 100) break;
            }

            const totalParaApagar = todasMensagensDoUsuario.length;
            if (totalParaApagar === 0) {
                await dmChannel.send('Nenhuma mensagem sua encontrada neste canal/DM.');
                await selfClient.destroy();
                activeCleanups.delete(discordUser.id);
                return;
            }

            const readyEmbed = new EmbedBuilder()
                .setTitle('CL PRONTO PARA INICIAR')
                .setDescription(`Encontradas **${totalParaApagar}** mensagens suas.\nClique em **Iniciar** para começar.`)
                .setColor(0xFEE75C);
            await controlMessage.edit({ embeds: [readyEmbed], components: [criarBotoesControle(true)] });

            while (cleanupData.paused && !cleanupData.cancelled) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            if (cleanupData.cancelled) {
                await selfClient.destroy();
                activeCleanups.delete(discordUser.id);
                return;
            }

            let apagadas = 0;

            for (const msg of todasMensagensDoUsuario) {
                while (cleanupData.paused && !cleanupData.cancelled) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                if (cleanupData.cancelled) break;

                try {
                    await msg.delete();
                    apagadas++;
                    await new Promise(resolve => setTimeout(resolve, 1500));

                    const porcentagem = Math.floor((apagadas / totalParaApagar) * 100);

                    const embedProgresso = new EmbedBuilder()
                        .setTitle('CL INICIADO')
                        .setDescription(`**${apagadas}/${totalParaApagar}** MENSAGENS APAGADAS (**${porcentagem}%**)`)
                        .setColor(0x57F287);

                    await controlMessage.edit({
                        embeds: [embedProgresso],
                        components: [criarBotoesControle(false)]
                    });
                } catch (err) {
                    // Ignora mensagens que já possam ter sido apagadas
                }
            }

            if (!cleanupData.cancelled) {
                const embedConcluido = new EmbedBuilder()
                    .setTitle('CL CONCLUÍDO')
                    .setDescription(`Todas as **${apagadas}** mensagens foram apagadas com sucesso!`)
                    .setColor(0x5865F2);

                await controlMessage.edit({
                    embeds: [embedConcluido],
                    components: []
                });
            } else {
                const embedCancelado = new EmbedBuilder()
                    .setTitle('CL CANCELADO')
                    .setDescription(`Processo interrompido. **${apagadas}/${totalParaApagar}** mensagens apagadas.`)
                    .setColor(0xED4245);

                await controlMessage.edit({
                    embeds: [embedCancelado],
                    components: []
                });
            }

        } catch (error) {
            await dmChannel.send(`Erro durante a execução: ${error.message}`);
        } finally {
            await selfClient.destroy();
            activeCleanups.delete(discordUser.id);
        }
    });

    try {
        await selfClient.login(token);
    } catch (err) {
        await dmChannel.send('Falha ao autenticar o User Token informado.');
        activeCleanups.delete(discordUser.id);
    }
}
bot.login(process.env.DISCORD_BOT_TOKEN);