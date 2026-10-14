# 📱 NayBinho Photos para Android

Aplicativo nativo para Android do **NayBinho Photos**, projetado para sincronização contínua e visualização imersiva de fotos e vídeos, conectando diretamente ao seu servidor pessoal via rede local (Wi-Fi) ou internet (domínio com SSL/HTTPS ou IP público).

---

## 🚀 Principais Recursos do Aplicativo

1. **Backup Automático em Segundo Plano (Mesmo com o App Fechado):**
   - Utiliza `androidx.work.WorkManager` para monitorar pastas do dispositivo de forma contínua.
   - Envia fotos e vídeos novos automaticamente sem que você precise abrir o aplicativo.
   - Continua funcionando mesmo após reiniciar o celular (`BOOT_COMPLETED`).

2. **Suporte Amplo a Pastas e WhatsApp:**
   - Câmera nativa (`DCIM/Camera`).
   - Fotos e Prints (`Pictures/`).
   - Mídias do WhatsApp (`WhatsApp Images` e `WhatsApp Video`).
   - Vídeos e Downloads (`Movies/`, `Download/`).

3. **Primeiro Acesso & Configuração Fácil:**
   - Solicita a URL do servidor (Ex: `http://192.168.1.100:9453` ou `https://fotos.meudominio.com`).
   - Realiza teste de conexão e autenticação com armazenamento seguro de credenciais no dispositivo.

4. **Experiência Imersiva Google Photos:**
   - Visualizador de tela cheia com gestos de deslize para passar fotos.
   - Mapa de lugares com miniaturas de fotos em cada cidade/bairro.
   - Favoritos com sincronização imediata.
   - Compartilhamento nativo para WhatsApp, Instagram, Telegram e outros apps instalados.

5. **Distribuição & Atualizações Diretas:**
   - O aplicativo checa novidades diretamente no servidor em `/atualizacao/version.json`.

---

## 🛠️ Como Gerar o Arquivo `.apk`

### Opção 1: Usando o Script PowerShell (Mais Rápido)
Abra o PowerShell no Windows e execute:
```powershell
powershell -ExecutionPolicy Bypass -File c:\Users\Douglas\Documents\Apps\Photos\apk\build_apk.ps1
```
O arquivo APK gerado estará em:
`apk/app/build/outputs/apk/debug/app-debug.apk`

---

### Opção 2: Pelo Android Studio

1. Abra o **Android Studio**.
2. Vá em **File > Open** e selecione a pasta:
   ```
   c:\Users\Douglas\Documents\Apps\Photos\apk
   ```
3. Aguarde o Android Studio sincronizar o projeto (*Gradle Sync*).
4. No menu superior:
   - **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. Ao concluir, clique em **locate** no pop-up do Android Studio para abrir a pasta do `.apk`.

---

## 📋 Requisitos e Compatibilidade

- **Android Mínimo:** Android 7.0 (API level 24).
- **Android Alvo:** Android 14 (API level 34).
- **Tráfego Cleartext:** Habilitado para permitir conexões `http://` com IPs locais da rede doméstica (porta `9453`).
