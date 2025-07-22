#!/bin/bash

# Simple resource monitoring for Tanabe GPT bot

echo "=== Tanabe GPT Resource Monitor ==="
echo "Press Ctrl+C to exit"
echo ""

while true; do
    clear
    echo "=== System Resources ==="
    echo "Time: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    
    # CPU usage
    echo "CPU Usage:"
    top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print "  Total: " 100 - $1"%"}'
    
    # Memory usage
    echo ""
    echo "Memory Usage:"
    free -m | awk 'NR==2{printf "  Used: %sMB / %sMB (%.2f%%)\n", $3,$2,$3*100/$2 }'
    
    # Node.js process
    echo ""
    echo "Node.js Process:"
    ps aux | grep -E "node.*app.js" | grep -v grep | awk '{printf "  PID: %s, CPU: %s%%, MEM: %s%%\n", $2, $3, $4}'
    
    # Disk usage
    echo ""
    echo "Disk Usage:"
    df -h / | awk 'NR==2{printf "  Root: %s / %s (%s)\n", $3, $2, $5}'
    
    sleep 5
done 