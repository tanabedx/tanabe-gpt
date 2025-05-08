#!/bin/bash
# VPS Setup Script for Tanabe-GPT
# - Sets up swap space
# - Configures system for better performance on low-resource VPS

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run this script as root (with sudo)"
  exit 1
fi

echo "====== Tanabe-GPT VPS Setup ======"
echo "Setting up optimal configuration for 1-core VPS..."

# Create swap file (2GB)
echo "[1/8] Setting up swap space (2GB)..."
if [ -f /swapfile ]; then
  echo "Swap file already exists. Removing old swap file..."
  swapoff /swapfile
  rm -f /swapfile
fi

fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Make swap permanent
echo "[2/8] Making swap permanent..."
if grep -q "/swapfile" /etc/fstab; then
  echo "Swap entry already exists in fstab. Skipping..."
else
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

# Optimize swap usage
echo "[3/8] Optimizing swap settings..."
echo "vm.swappiness=10" > /etc/sysctl.d/99-swappiness.conf
echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.d/99-swappiness.conf
sysctl -p /etc/sysctl.d/99-swappiness.conf

# Install necessary system packages
echo "[4/8] Installing system dependencies..."
apt-get update
apt-get install -y htop curl git build-essential

# Set up Node.js environment
echo "[5/8] Setting up Node.js environment..."
# Install or upgrade npm
if ! command -v npm &> /dev/null; then
  echo "npm not found, installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "npm already installed."
fi

# Install application dependencies
echo "[6/8] Installing application dependencies (this may take a few minutes)..."
# Get current user to restore ownership later
SCRIPT_USER=$(logname || echo "$SUDO_USER")
if [ -z "$SCRIPT_USER" ]; then
  SCRIPT_USER=$(who am i | awk '{print $1}')
fi

# Install dependencies
npm install

# Check if whatsapp-web.js is installed
if ! npm list | grep -q "whatsapp-web.js"; then
  echo "Installing whatsapp-web.js specifically..."
  npm install whatsapp-web.js
fi

# The npm install might have created files as root, fix ownership
if [ -n "$SCRIPT_USER" ] && [ "$SCRIPT_USER" != "root" ]; then
  echo "Fixing file ownership for user $SCRIPT_USER..."
  chown -R "$SCRIPT_USER:$(id -gn $SCRIPT_USER 2>/dev/null || echo $SCRIPT_USER)" .
fi

# Setup .env file
echo "[7/8] Setting up environment configuration (.env file)..."

ENV_FILE=".env"
if [ -f "$ENV_FILE" ]; then
  echo "Existing .env file found. Would you like to:"
  echo "1) Keep existing .env file"
  echo "2) Create new .env file"
  read -p "Enter choice [1-2]: " env_choice
  
  if [ "$env_choice" != "1" ]; then
    mv "$ENV_FILE" "${ENV_FILE}.backup.$(date +%s)"
    echo "Existing .env file backed up."
  else
    echo "Keeping existing .env file."
    ENV_SETUP_SKIPPED=true
  fi
fi

if [ -z "$ENV_SETUP_SKIPPED" ]; then
  echo ""
  echo "========================================"
  echo "Setting up .env file for Tanabe-GPT"
  echo "========================================"
  
  # Create temporary file
  TEMP_ENV=$(mktemp)
  
  echo "Please paste your entire .env file content below."
  echo "If you don't have an .env file prepared, just press Ctrl+D and we'll create a minimal one."
  echo "Press Ctrl+D when finished pasting."
  echo "------------------------"
  
  # Read multi-line input until Ctrl+D is pressed
  while IFS= read -r line; do
    echo "$line" >> "$TEMP_ENV"
  done
  
  echo "------------------------"
  
  # Check if the file has content and if not, create a minimal config
  if [ ! -s "$TEMP_ENV" ]; then
    echo "Creating minimal .env configuration..."
    echo "NODE_ENV=production" >> "$TEMP_ENV"
    echo "# Add your OpenAI API key below" >> "$TEMP_ENV"
    echo "OPENAI_API_KEY=your_openai_api_key_here" >> "$TEMP_ENV"
    echo "# Add your WhatsApp admin ID below (format: number@c.us)" >> "$TEMP_ENV"
    echo "ADMIN_WHATSAPP_ID=your_whatsapp_id_here" >> "$TEMP_ENV"
    
    # Add WhatsApp special messages from user input
    echo "" >> "$TEMP_ENV"
    echo "# Special Messages" >> "$TEMP_ENV"
    echo "WIZARD_WELCOME_MESSAGE=\"Olá, Mamãe querida!\n\nPara configurar um novo grupo para fazer resumos, envie *#ferramentaresumo*.\n\nTe amo!\"" >> "$TEMP_ENV"
    
    # Add Group Personalities from user input
    echo "" >> "$TEMP_ENV"
    echo "# Group Personalities" >> "$TEMP_ENV"
    echo "GROUP_LF_PERSONALITY=\"DIRETRIZES:\n\n\nVocê é um bot assistente pessoal em um grupo de WhatsApp de amigos. Sua função é:\n\n1. Ser conciso nas suas respostas.\n2. Ser pessoal com os indivíduos que conversam com você, se dirigindo pessoalmente e diretamente à pessoa.\n3. Ser formal e eloquente, a não ser que a pergunta do usuário comece com '!'.\n4. Não utilizar informações antecedentes como 'minha resposta é' ou 'resposta:'.\n5. Ter consciência de que você está em um grupo de WhatsApp, os membros já sabem quem você é e que você está respondendo algo, logo não é necessário se anunciar.\n6. Construir suas respostas em formato e como outro integrante de um grupo de WhatsApp.\n7. Se você for insultado, insulte de volta de jeito irônico baseado nas características dos integrantes:\n\n- Felipeviathan\\\" Boacnin: Ele é o Leviatan, o chefe supremo, ele só aparece de vez em quando.\n- Gabriel \\\"Farialimer\\\" Madasi: Ele é um economista certinho.\n- Gabriel \\\"Raichavasca\\\" Paro\"" >> "$TEMP_ENV"
  fi
  
  # Check if the VPS optimization settings are already in the file
  if ! grep -q "OPTIMIZE_FOR_VPS" "$TEMP_ENV"; then
    echo "" >> "$TEMP_ENV"
    echo "# VPS Optimization Settings" >> "$TEMP_ENV"
    echo "OPTIMIZE_FOR_VPS=true" >> "$TEMP_ENV"
    echo "FORCE_DEBUG_LOGS=false" >> "$TEMP_ENV"
    echo "FORCE_PROMPT_LOGS=false" >> "$TEMP_ENV"
  fi
  
  # Move temp file to .env
  mv "$TEMP_ENV" "$ENV_FILE"
  chmod 600 "$ENV_FILE"  # Secure permissions for API keys
  
  echo ""
  echo ".env file created successfully!"
  echo "IMPORTANT: If you used the minimal template, edit the file with: nano .env"
  echo "           You must set your actual API keys before running the application."
fi

# Create logs directory
mkdir -p logs

# Create Systemd Service
echo "[8/8] Setting up systemd service..."

# Get username for service file
if [ -z "$SCRIPT_USER" ] || [ "$SCRIPT_USER" = "root" ]; then
  read -p "Enter the username that should run the application: " SERVICE_USER
else
  SERVICE_USER=$SCRIPT_USER
fi

# Get current directory
CURRENT_DIR=$(pwd)

# Create the service file
SERVICE_FILE="/etc/systemd/system/tanabe-gpt.service"
cat > "$SERVICE_FILE" << EOL
[Unit]
Description=Tanabe-GPT WhatsApp Bot
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${CURRENT_DIR}
ExecStart=/usr/bin/node --expose-gc index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=tanabe-gpt
Environment=NODE_ENV=production
Environment=OPTIMIZE_FOR_VPS=true
Environment=FORCE_DEBUG_LOGS=false
Environment=FORCE_PROMPT_LOGS=false

# Restart daily at 3 AM for memory management
ExecStop=/bin/kill -SIGINT \$MAINPID
Restart=always
RestartSec=10
RuntimeMaxSec=86400

[Install]
WantedBy=multi-user.target
EOL

echo "Systemd service created at $SERVICE_FILE"
systemctl daemon-reload
echo "Would you like to enable and start the service now? (y/n)"
read -p "Choice: " start_service

if [[ "$start_service" == "y" || "$start_service" == "Y" ]]; then
  systemctl enable tanabe-gpt
  systemctl start tanabe-gpt
  echo "Service enabled and started. Check status with: systemctl status tanabe-gpt"
else
  echo "Service created but not started. You can start it manually with: sudo systemctl start tanabe-gpt"
fi

echo ""
echo "====== Setup Complete ======"
echo "Swap space enabled: $(free -h 2>/dev/null | grep Swap || echo 'Swap: 2GB')"
echo "System optimized for low-resource VPS environment"
echo ""
echo "To start the application manually, run:"
echo "node --expose-gc index.js"
echo ""
echo "To monitor memory usage, run:"
echo "htop"
echo ""
echo "To check the service status:"
echo "systemctl status tanabe-gpt"
echo ""
echo "To view logs:"
echo "journalctl -u tanabe-gpt -f"
echo "" 