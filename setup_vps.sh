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

# Install PM2 globally
echo "[6/8] Installing PM2 process manager..."
npm install -g pm2

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
  echo "Please provide the following information:"
  echo ""
  
  # Create temporary file
  TEMP_ENV=$(mktemp)
  
  # Environment
  echo "NODE_ENV=production" > "$TEMP_ENV"
  
  # OpenAI API Key
  read -p "Enter your OpenAI API Key: " openai_key
  echo "OPENAI_API_KEY=$openai_key" >> "$TEMP_ENV"
  
  # Ask for WhatsApp admin ID
  read -p "Enter WhatsApp Admin ID (number@c.us format): " admin_id
  echo "ADMIN_WHATSAPP_ID=$admin_id" >> "$TEMP_ENV"

  # Ask if user wants to paste entire .env content
  echo ""
  echo "Would you like to paste additional environment variables? (y/n)"
  read -p "Choice: " paste_choice
  
  if [[ "$paste_choice" == "y" || "$paste_choice" == "Y" ]]; then
    echo ""
    echo "Paste your additional environment variables below (press Ctrl+D when finished):"
    echo "Note: Lines starting with # will be preserved as comments"
    echo "------------------------"
    
    # Read multi-line input until Ctrl+D is pressed
    while IFS= read -r line; do
      # Skip if line already has NODE_ENV, OPENAI_API_KEY, or ADMIN_WHATSAPP_ID
      if [[ "$line" =~ ^(NODE_ENV|OPENAI_API_KEY|ADMIN_WHATSAPP_ID)= ]]; then
        continue
      fi
      echo "$line" >> "$TEMP_ENV"
    done
    
    echo "------------------------"
  fi
  
  # Additional recommended settings
  echo "" >> "$TEMP_ENV"
  echo "# VPS Optimization Settings" >> "$TEMP_ENV"
  echo "OPTIMIZE_FOR_VPS=true" >> "$TEMP_ENV"
  echo "FORCE_DEBUG_LOGS=false" >> "$TEMP_ENV"
  echo "FORCE_PROMPT_LOGS=false" >> "$TEMP_ENV"
  
  # Move temp file to .env
  mv "$TEMP_ENV" "$ENV_FILE"
  chmod 600 "$ENV_FILE"  # Secure permissions for API keys
  
  echo ""
  echo ".env file created successfully!"
  echo "You can edit it later if needed with: nano .env"
fi

# Create PM2 ecosystem file
echo "[8/8] Creating PM2 ecosystem configuration..."
cat > ecosystem.config.js << 'EOL'
module.exports = {
  apps: [{
    name: "tanabe-gpt",
    script: "index.js",
    instances: 1,
    exec_mode: "fork",
    max_memory_restart: "350M",
    node_args: "--expose-gc --max-old-space-size=256",
    env: {
      NODE_ENV: "production"
    },
    exp_backoff_restart_delay: 100,
    watch: false,
    merge_logs: true,
    error_file: "logs/pm2-error.log",
    out_file: "logs/pm2-out.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    kill_timeout: 5000,
    cron_restart: "0 3 * * *" // Daily restart at 3 AM
  }]
};
EOL

# Create logs directory
mkdir -p logs

echo ""
echo "====== Setup Complete ======"
echo "Swap space enabled: $(free -h | grep Swap)"
echo "System optimized for low-resource VPS environment"
echo ""
echo "To start the application with PM2, run:"
echo "pm2 start ecosystem.config.js"
echo ""
echo "To monitor memory usage, run:"
echo "htop"
echo "" 