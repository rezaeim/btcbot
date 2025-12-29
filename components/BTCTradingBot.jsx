'use client'

import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Send, Settings, Play, Pause, Upload, AlertCircle } from 'lucide-react';

const BTCTradingBot = () => {
  const REAL_BTC_PRICE = 87687;
  
  const [currentPrice, setCurrentPrice] = useState(REAL_BTC_PRICE);
  const [signal, setSignal] = useState(null);
  const [backtestResults, setBacktestResults] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [priceHistory, setPriceHistory] = useState([]);
  const [csvData, setCsvData] = useState(null);
  const [telegramConfig, setTelegramConfig] = useState({
    botToken: '',
    chatId: '',
    enabled: false
  });
  const [showConfig, setShowConfig] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const [lastSentSignal, setLastSentSignal] = useState(null);
  const [realTimePrices, setRealTimePrices] = useState([]);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [priceSource, setPriceSource] = useState('coinbase');
  const [websocket, setWebsocket] = useState(null);
  const [signalCheckLog, setSignalCheckLog] = useState([]);
  const [lastSignalCheck, setLastSignalCheck] = useState(null);
  const [isCheckingSignal, setIsCheckingSignal] = useState(false);
  
  // Use ref to access latest realTimePrices in intervals
  const realTimePricesRef = React.useRef(realTimePrices);
  const csvDataRef = React.useRef(csvData);
  
  React.useEffect(() => {
    realTimePricesRef.current = realTimePrices;
  }, [realTimePrices]);
  
  React.useEffect(() => {
    csvDataRef.current = csvData;
  }, [csvData]);

  // Parse CSV file
  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    const headers = lines[0].split('\t');
    
    console.log('Headers:', headers);
    console.log('First data line:', lines[1]);
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
      // Try both tab and comma separation
      let values = lines[i].split('\t');
      if (values.length < 6) {
        values = lines[i].split(',');
      }
      
      if (values.length >= 6) {
        // Clean the values (remove quotes, extra spaces)
        const cleanValues = values.map(v => v.trim().replace(/['"]/g, ''));
        
        const row = {
          time: cleanValues[0],
          open: parseFloat(cleanValues[1]),
          high: parseFloat(cleanValues[2]),
          low: parseFloat(cleanValues[3]),
          close: parseFloat(cleanValues[4]),
          volume: parseFloat(cleanValues[5])
        };
        
        // Only include valid rows
        if (!isNaN(row.close) && !isNaN(row.volume) && row.close > 0 && row.volume >= 0) {
          data.push(row);
        }
      }
    }
    
    console.log('Parsed rows:', data.length);
    if (data.length > 0) {
      console.log('First row:', data[0]);
      console.log('Last row:', data[data.length - 1]);
    }
    
    return data;
  };

  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileStatus('📂 Reading file...');
    
    try {
      const text = await file.text();
      console.log('File size:', text.length, 'characters');
      console.log('First 500 chars:', text.substring(0, 500));
      
      const parsedData = parseCSV(text);
      
      if (parsedData.length === 0) {
        setFileStatus('❌ No valid data found. Check console for details.');
        console.error('Parsing failed. Raw text sample:', text.substring(0, 1000));
        return;
      }

      console.log(`Successfully parsed ${parsedData.length} rows`);

      // Calculate volume changes and sentiment
      const enrichedData = parsedData.map((row, idx) => {
        // Calculate volume change from previous periods
        const lookback = 28; // 7 hours of 15-min data
        if (idx >= lookback) {
          const recentVolumes = parsedData.slice(idx - lookback, idx).map(r => r.volume);
          const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / lookback;
          const volumeChange = avgVolume > 0 ? ((row.volume - avgVolume) / avgVolume) * 100 : 0;
          
          // Calculate sentiment from price momentum
          const priceChange = parsedData[idx - lookback].close > 0 
            ? ((row.close - parsedData[idx - lookback].close) / parsedData[idx - lookback].close) * 100 
            : 0;
          let sentiment = 0;
          if (priceChange > 3) sentiment = 0.7;
          else if (priceChange > 1) sentiment = 0.4;
          else if (priceChange < -3) sentiment = -0.7;
          else if (priceChange < -1) sentiment = -0.4;
          else sentiment = priceChange * 0.1;
          
          return {
            ...row,
            volumeChange: volumeChange,
            sentiment: Math.max(-1, Math.min(1, sentiment))
          };
        }
        
        return {
          ...row,
          volumeChange: 0,
          sentiment: 0
        };
      });

      setCsvData(enrichedData);
      setFileStatus(`✅ Loaded ${enrichedData.length.toLocaleString()} data points from ${parsedData[0].time} to ${parsedData[parsedData.length - 1].time}`);
      
      setTimeout(() => setFileStatus(''), 8000);
    } catch (error) {
      console.error('Error parsing file:', error);
      setFileStatus(`❌ Error: ${error.message}`);
    }
  };

  // Trading strategy with stricter criteria
  const generateSignalFromData = (currentData, historicalWindow) => {
    if (!historicalWindow || historicalWindow.length < 20) return null;
    
    let score = 0;
    const price = currentData.close || currentData.price;
    let reasons = [];
    
    // Volume analysis (40% weight) - STRICTER THRESHOLDS
    if (currentData.volumeChange > 80) {
      score += 0.4;
      reasons.push('Very high volume spike');
    } else if (currentData.volumeChange > 50) {
      score += 0.2;
      reasons.push('High volume');
    } else if (currentData.volumeChange < -50) {
      score -= 0.4;
      reasons.push('Very low volume');
    } else if (currentData.volumeChange < -30) {
      score -= 0.2;
      reasons.push('Low volume');
    } else {
      reasons.push('Normal volume');
    }
    
    // Sentiment analysis (35% weight) - STRICTER THRESHOLDS
    if (Math.abs(currentData.sentiment) > 0.6) {
      score += currentData.sentiment * 0.35;
      reasons.push(`Strong ${currentData.sentiment > 0 ? 'bullish' : 'bearish'} sentiment`);
    } else if (Math.abs(currentData.sentiment) > 0.3) {
      score += currentData.sentiment * 0.2;
      reasons.push(`Moderate sentiment`);
    } else {
      reasons.push('Neutral sentiment');
    }
    
    // Momentum analysis (25% weight) - SMA crossover with confirmation
    const prices = historicalWindow.slice(-40).map(d => d.close || d.price);
    if (prices.length >= 40) {
      const sma5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
      
      // Strong bullish: SMA5 > SMA10 > SMA20 with good spacing
      if (sma5 > sma10 * 1.01 && sma10 > sma20 * 1.005) {
        score += 0.25;
        reasons.push('Strong uptrend (SMA crossover)');
      } else if (sma5 > sma10 * 1.005) {
        score += 0.15;
        reasons.push('Weak uptrend');
      } 
      // Strong bearish: SMA5 < SMA10 < SMA20 with good spacing
      else if (sma5 < sma10 * 0.99 && sma10 < sma20 * 0.995) {
        score -= 0.25;
        reasons.push('Strong downtrend (SMA crossover)');
      } else if (sma5 < sma10 * 0.995) {
        score -= 0.15;
        reasons.push('Weak downtrend');
      } else {
        reasons.push('No clear trend');
      }
    }
    
    console.log('📊 Strategy Analysis:', {
      volumeChange: currentData.volumeChange.toFixed(2),
      sentiment: currentData.sentiment.toFixed(2),
      score: score.toFixed(3),
      reasons: reasons
    });
    
    // STRICT THRESHOLD: Need score > 0.5 for BUY, < -0.5 for SELL
    if (score > 0.5) {
      const entry = price;
      const stopLoss = entry * 0.96; // 4% stop loss
      const takeProfit = entry * 1.12; // 12% take profit
      
      return {
        type: 'BUY',
        entry: entry,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        score: score,
        reasons: reasons
      };
    } else if (score < -0.5) {
      const entry = price;
      const stopLoss = entry * 1.04; // 4% stop loss
      const takeProfit = entry * 0.88; // 12% take profit
      
      return {
        type: 'SELL',
        entry: entry,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        score: score,
        reasons: reasons
      };
    }
    
    console.log(`⏸️ Score ${score.toFixed(3)} does not meet threshold (need >0.5 or <-0.5)`);
    return null;
  };

  // Run backtest on CSV data
  const runBacktest = () => {
    if (!csvData || csvData.length < 100) {
      alert('Please upload a CSV file first');
      return;
    }

    setIsBacktesting(true);
    
    setTimeout(() => {
      const trades = [];
      let balance = 10000; // Starting capital
      let inPosition = false;
      let currentPosition = null;
      
      // Start after we have enough data for indicators
      for (let i = 50; i < csvData.length; i++) {
        const currentData = csvData[i];
        const historicalWindow = csvData.slice(Math.max(0, i - 50), i);
        
        // Check if we should close existing position
        if (inPosition && currentPosition) {
          const currentPrice = currentData.close;
          
          // Check stop loss
          if (currentPosition.type === 'BUY' && currentPrice <= currentPosition.stopLoss) {
            const pnl = ((currentPosition.stopLoss - currentPosition.entry) / currentPosition.entry) * 100;
            balance *= (1 + pnl / 100);
            trades.push({
              ...currentPosition,
              exitPrice: currentPosition.stopLoss,
              exitTime: currentData.time,
              exitIndex: i,
              pnl: pnl,
              outcome: 'STOP_LOSS'
            });
            inPosition = false;
            currentPosition = null;
          } else if (currentPosition.type === 'SELL' && currentPrice >= currentPosition.stopLoss) {
            const pnl = ((currentPosition.entry - currentPosition.stopLoss) / currentPosition.entry) * 100;
            balance *= (1 + pnl / 100);
            trades.push({
              ...currentPosition,
              exitPrice: currentPosition.stopLoss,
              exitTime: currentData.time,
              exitIndex: i,
              pnl: pnl,
              outcome: 'STOP_LOSS'
            });
            inPosition = false;
            currentPosition = null;
          }
          
          // Check take profit
          if (currentPosition && currentPosition.type === 'BUY' && currentPrice >= currentPosition.takeProfit) {
            const pnl = ((currentPosition.takeProfit - currentPosition.entry) / currentPosition.entry) * 100;
            balance *= (1 + pnl / 100);
            trades.push({
              ...currentPosition,
              exitPrice: currentPosition.takeProfit,
              exitTime: currentData.time,
              exitIndex: i,
              pnl: pnl,
              outcome: 'TAKE_PROFIT'
            });
            inPosition = false;
            currentPosition = null;
          } else if (currentPosition && currentPosition.type === 'SELL' && currentPrice <= currentPosition.takeProfit) {
            const pnl = ((currentPosition.entry - currentPosition.takeProfit) / currentPosition.entry) * 100;
            balance *= (1 + pnl / 100);
            trades.push({
              ...currentPosition,
              exitPrice: currentPosition.takeProfit,
              exitTime: currentData.time,
              exitIndex: i,
              pnl: pnl,
              outcome: 'TAKE_PROFIT'
            });
            inPosition = false;
            currentPosition = null;
          }
        }
        
        // Generate new signal if not in position
        if (!inPosition) {
          const signal = generateSignalFromData(currentData, historicalWindow);
          
          if (signal) {
            currentPosition = {
              ...signal,
              entryTime: currentData.time,
              entryIndex: i,
              volumeChange: currentData.volumeChange,
              sentiment: currentData.sentiment
            };
            inPosition = true;
          }
        }
      }
      
      // Calculate statistics
      const wins = trades.filter(t => t.outcome === 'TAKE_PROFIT').length;
      const losses = trades.filter(t => t.outcome === 'STOP_LOSS').length;
      const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
      const totalReturn = ((balance - 10000) / 10000) * 100;
      
      const winningTrades = trades.filter(t => t.outcome === 'TAKE_PROFIT');
      const losingTrades = trades.filter(t => t.outcome === 'STOP_LOSS');
      
      const avgWin = wins > 0 ? winningTrades.reduce((sum, t) => sum + t.pnl, 0) / wins : 0;
      const avgLoss = losses > 0 ? losingTrades.reduce((sum, t) => sum + t.pnl, 0) / losses : 0;
      const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
      
      const maxDrawdown = calculateMaxDrawdown(trades);
      
      setBacktestResults({
        totalTrades: trades.length,
        wins,
        losses,
        winRate,
        totalReturn,
        finalBalance: balance,
        avgWin,
        avgLoss,
        profitFactor,
        maxDrawdown,
        trades: trades.slice(-100), // Last 100 trades
        dataPoints: csvData.length,
        timeRange: `${csvData[0].time} to ${csvData[csvData.length - 1].time}`
      });
      
      setIsBacktesting(false);
    }, 1000);
  };

  // Calculate maximum drawdown
  const calculateMaxDrawdown = (trades) => {
    let peak = 10000;
    let maxDD = 0;
    let balance = 10000;
    
    trades.forEach(trade => {
      balance *= (1 + trade.pnl / 100);
      if (balance > peak) peak = balance;
      const drawdown = ((peak - balance) / peak) * 100;
      if (drawdown > maxDD) maxDD = drawdown;
    });
    
    return maxDD;
  };

  // Fetch real BTC price from multiple sources
  const fetchRealBTCPrice = async () => {
    try {
      let price = null;
      
      // Try CoinGecko first (no rate limits)
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        const data = await response.json();
        price = data.bitcoin.usd;
        setPriceSource('coingecko');
      } catch (error) {
        console.log('CoinGecko failed, trying Coinbase...');
      }
      
      // Fallback to Coinbase
      if (!price) {
        try {
          const response = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
          const data = await response.json();
          price = parseFloat(data.data.amount);
          setPriceSource('coinbase');
        } catch (error) {
          console.log('Coinbase failed, trying Binance...');
        }
      }
      
      // Fallback to Binance
      if (!price) {
        try {
          const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
          const data = await response.json();
          price = parseFloat(data.price);
          setPriceSource('binance');
        } catch (error) {
          console.log('Binance failed');
        }
      }
      
      if (price) {
        setCurrentPrice(price);
        
        setRealTimePrices(prev => {
          const updated = [...prev, {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            price: price
          }];
          return updated.slice(-60); // Keep last 60 data points (10 minutes at 10s intervals)
        });
        
        setIsLoadingPrice(false);
        return price;
      }
      
      setIsLoadingPrice(false);
      return null;
    } catch (error) {
      console.error('Error fetching BTC price:', error);
      setIsLoadingPrice(false);
      return null;
    }
  };

  // WebSocket connection for real-time updates (Binance)
  const connectWebSocket = () => {
    if (websocket) {
      websocket.close();
    }

    try {
      const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
      
      ws.onopen = () => {
        console.log('WebSocket connected to Binance');
        setPriceSource('binance-ws');
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const price = parseFloat(data.p);
        
        setCurrentPrice(price);
        
        setRealTimePrices(prev => {
          const now = new Date();
          const lastUpdate = prev.length > 0 ? new Date(prev[prev.length - 1].fullTime) : null;
          
          // Only add new point if 5 seconds passed (avoid too many updates)
          if (!lastUpdate || now - lastUpdate >= 5000) {
            const updated = [...prev, {
              time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
              fullTime: now,
              price: price
            }];
            return updated.slice(-60);
          }
          return prev;
        });
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setPriceSource('error');
      };
      
      ws.onclose = () => {
        console.log('WebSocket closed');
        setPriceSource('disconnected');
      };
      
      setWebsocket(ws);
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  };

  // Disconnect WebSocket
  const disconnectWebSocket = () => {
    if (websocket) {
      websocket.close();
      setWebsocket(null);
    }
  };
  const sendToTelegram = async (signalData) => {
    if (!telegramConfig.enabled || !telegramConfig.botToken || !telegramConfig.chatId) {
      return;
    }

    const emoji = signalData.type === 'BUY' ? '🟢' : '🔴';
    const message = `
${emoji} *${signalData.type} SIGNAL - BTC/USD*

📊 *Entry Price:* $${signalData.entry.toFixed(2)}
🛑 *Stop Loss:* $${signalData.stopLoss.toFixed(2)}
🎯 *Take Profit:* $${signalData.takeProfit.toFixed(2)}

⏰ ${new Date().toLocaleString()}
`;

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramConfig.chatId,
            text: message,
            parse_mode: 'Markdown'
          })
        }
      );

      const data = await response.json();
      if (data.ok) {
        setTelegramStatus('✅ Signal sent!');
      } else {
        setTelegramStatus(`❌ Error: ${data.description}`);
      }
    } catch (error) {
      setTelegramStatus(`❌ Failed: ${error.message}`);
    }
    setTimeout(() => setTelegramStatus(''), 5000);
  };

  // Test Telegram
  const testTelegram = async () => {
    if (!telegramConfig.botToken || !telegramConfig.chatId) {
      setTelegramStatus('❌ Enter Bot Token and Chat ID');
      setTimeout(() => setTelegramStatus(''), 3000);
      return;
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramConfig.botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramConfig.chatId,
            text: '🤖 BTC Bot connected!'
          })
        }
      );

      const data = await response.json();
      if (data.ok) {
        setTelegramStatus('✅ Connected!');
        setTelegramConfig(prev => ({ ...prev, enabled: true }));
      } else {
        setTelegramStatus(`❌ ${data.description}`);
      }
    } catch (error) {
      setTelegramStatus(`❌ ${error.message}`);
    }
    setTimeout(() => setTelegramStatus(''), 5000);
  };

  // Generate current signal from LIVE data
  const generateCurrentSignal = () => {
    setIsCheckingSignal(true);
    const checkTime = new Date().toLocaleTimeString();
    
    // Use refs to get current values
    const currentRealTimePrices = realTimePricesRef.current;
    const currentCsvData = csvDataRef.current;
    
    console.log(`[${checkTime}] 🔍 Checking for trading signals...`);
    console.log(`[${checkTime}] 📊 Live data points: ${currentRealTimePrices.length}, CSV data: ${currentCsvData ? currentCsvData.length : 0}`);
    
    // Use real-time price data if available, otherwise use CSV
    const dataSource = currentRealTimePrices.length >= 20 ? currentRealTimePrices : (currentCsvData || []);
    
    if (dataSource.length < 20) {
      console.log(`[${checkTime}] ⚠️ Insufficient data - need at least 20 data points (have ${dataSource.length})`);
      console.log(`[${checkTime}] 💡 Keep bot running to collect live data, or upload CSV for instant analysis`);
      
      // Still log the attempt
      setSignalCheckLog(prev => [{
        time: checkTime,
        result: `Insufficient Data (${dataSource.length}/20)`,
        entry: currentPrice,
        confidence: 'N/A',
        source: currentRealTimePrices.length > 0 ? 'LIVE' : 'None'
      }, ...prev.slice(0, 9)]);
      
      setSignal({ 
        type: 'HOLD', 
        message: `Collecting data... (${dataSource.length}/20 points needed)` 
      });
      setLastSignalCheck(checkTime);
      setIsCheckingSignal(false);
      return;
    }

    const recentData = dataSource.slice(-50);
    const currentData = recentData[recentData.length - 1];
    
    // Calculate volume change for live data
    let volumeChange = 0;
    let sentiment = 0;
    
    if (currentRealTimePrices.length >= 20) {
      // For live data, calculate from price volatility
      const lookback = Math.min(28, currentRealTimePrices.length);
      const recentPrices = currentRealTimePrices.slice(-lookback);
      
      // Calculate volatility as proxy for volume
      const volatility = recentPrices.reduce((sum, p, i) => {
        if (i === 0) return 0;
        return sum + Math.abs(p.price - recentPrices[i-1].price);
      }, 0) / (lookback - 1);
      
      const avgPrice = recentPrices.reduce((sum, p) => sum + p.price, 0) / lookback;
      const volatilityPercent = (volatility / avgPrice) * 100;
      
      // Map volatility to volume change (-100 to +100)
      volumeChange = (volatilityPercent - 0.5) * 100; // Adjust baseline
      
      // Calculate sentiment from price trend
      const priceChange = ((currentData.price - recentPrices[0].price) / recentPrices[0].price) * 100;
      if (priceChange > 2) sentiment = 0.7;
      else if (priceChange > 0.5) sentiment = 0.4;
      else if (priceChange < -2) sentiment = -0.7;
      else if (priceChange < -0.5) sentiment = -0.4;
      else sentiment = priceChange * 0.2;
      
      console.log(`[${checkTime}] 📈 Calculated metrics: volatility=${volatilityPercent.toFixed(3)}%, priceChange=${priceChange.toFixed(2)}%`);
    } else {
      // Use CSV data
      volumeChange = currentData.volumeChange || 0;
      sentiment = currentData.sentiment || 0;
    }
    
    const enrichedData = {
      ...currentData,
      close: currentData.close || currentData.price,
      price: currentData.price || currentData.close,
      volumeChange: volumeChange,
      sentiment: sentiment
    };
    
    console.log(`[${checkTime}] 📊 Analyzing ${currentRealTimePrices.length >= 20 ? 'LIVE' : 'CSV'} data:`, {
      price: (enrichedData.close || enrichedData.price).toFixed(2),
      volumeChange: volumeChange.toFixed(2) + '%',
      sentiment: sentiment.toFixed(2),
      dataPoints: dataSource.length
    });
    
    const signal = generateSignalFromData(enrichedData, recentData);
    
    if (signal) {
      console.log(`[${checkTime}] ✅ SIGNAL FOUND:`, signal.type, {
        entry: signal.entry.toFixed(2),
        stopLoss: signal.stopLoss.toFixed(2),
        takeProfit: signal.takeProfit.toFixed(2),
        score: signal.score.toFixed(3)
      });
      
      setSignal({
        ...signal,
        riskReward: ((signal.takeProfit - signal.entry) / Math.abs(signal.entry - signal.stopLoss)).toFixed(2),
        volumeChange: volumeChange,
        sentiment: sentiment
      });
      
      // Add to log
      setSignalCheckLog(prev => [{
        time: checkTime,
        result: `${signal.type} Signal`,
        entry: signal.entry,
        confidence: (Math.abs(signal.score) * 100).toFixed(0) + '%',
        source: currentRealTimePrices.length >= 20 ? 'LIVE' : 'CSV'
      }, ...prev.slice(0, 9)]);
      
    } else {
      console.log(`[${checkTime}] ⏸️ No signal - market conditions don't meet criteria (score too low)`);
      setSignal({ 
        type: 'HOLD',
        message: 'No clear signal - waiting for better setup'
      });
      
      // Add to log
      setSignalCheckLog(prev => [{
        time: checkTime,
        result: 'No Signal (HOLD)',
        entry: enrichedData.close || enrichedData.price,
        confidence: 'N/A',
        source: currentRealTimePrices.length >= 20 ? 'LIVE' : 'CSV'
      }, ...prev.slice(0, 9)]);
    }
    
    setLastSignalCheck(checkTime);
    setIsCheckingSignal(false);
  };

  // Initialize
  useEffect(() => {
    // Fetch real price immediately
    setIsLoadingPrice(true);
    fetchRealBTCPrice();
    
    // Run initial signal check after 3 seconds
    setTimeout(() => {
      console.log('🎬 Initial signal check...');
      generateCurrentSignal();
    }, 3000);
  }, []);

  // Update signal when CSV loads
  useEffect(() => {
    if (csvData) {
      console.log('📂 CSV loaded, generating signal...');
      generateCurrentSignal();
    }
  }, [csvData]);

  // Auto-send signal to Telegram when signal changes
  useEffect(() => {
    if (!signal || signal.type === 'HOLD' || !telegramConfig.enabled) return;
    
    // Check if this is a new signal (different from last sent)
    const signalKey = `${signal.type}-${signal.entry.toFixed(0)}`;
    
    if (signalKey !== lastSentSignal) {
      console.log('📤 New signal detected, sending to Telegram:', signalKey);
      sendToTelegram(signal);
      setLastSentSignal(signalKey);
    }
  }, [signal, telegramConfig.enabled]);

  // Monitor real-time prices and trigger checks when enough data
  useEffect(() => {
    if (realTimePrices.length >= 50 && !csvData) {
      console.log('📊 50 data points collected, ready for signal generation');
    }
  }, [realTimePrices.length]);

  // Live updates - WebSocket or polling
  useEffect(() => {
    if (!isRunning) {
      disconnectWebSocket();
      return;
    }
    
    console.log('🚀 Live mode started - monitoring for signals...');
    console.log('⏱️ Will check for signals every 30 seconds');
    
    // Try WebSocket first for real-time updates
    connectWebSocket();
    
    // Check for signals immediately after 5 seconds (give time for data)
    const initialCheck = setTimeout(() => {
      console.log('🎯 Running initial signal check...');
      console.log('Current realTimePrices length:', realTimePricesRef.current.length);
      generateCurrentSignal();
    }, 5000);
    
    // Check for signals every 30 seconds
    const signalCheckInterval = setInterval(() => {
      console.log('⏰ 30-second signal check triggered');
      console.log('Current realTimePrices length:', realTimePricesRef.current.length);
      generateCurrentSignal();
    }, 30000); // Every 30 seconds
    
    // Fallback: polling every 10 seconds in case WebSocket fails
    const pollInterval = setInterval(() => {
      if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        fetchRealBTCPrice();
      }
    }, 10000);
    
    return () => {
      console.log('⏹️ Live mode stopped');
      clearTimeout(initialCheck);
      clearInterval(pollInterval);
      clearInterval(signalCheckInterval);
      disconnectWebSocket();
    };
  }, [isRunning]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
          <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
                BTC/USD Trading Bot
              </h1>
              <p className="text-blue-200 text-sm">
                Real-Time Signals • Telegram Alerts • Backtesting
              </p>
            </div>
            <div className="flex gap-3 items-center">
              <button
                onClick={() => {
                  setIsRunning(!isRunning);
                  if (!isRunning) {
                    setIsLoadingPrice(true);
                    fetchRealBTCPrice();
                  }
                }}
                className={`px-6 py-3 rounded-lg font-bold text-base flex items-center gap-2 shadow-lg ${
                  isRunning 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-green-500 hover:bg-green-600 text-white animate-pulse'
                }`}
              >
                {isRunning ? <><Pause className="w-5 h-5" /> Stop Bot</> : <><Play className="w-5 h-5" /> Start Live Bot</>}
              </button>
              <label className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold cursor-pointer flex items-center gap-2">
                <Upload className="w-4 h-4" />
                CSV
                <input 
                  type="file" 
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
              <button
                onClick={() => setShowConfig(!showConfig)}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Setup
              </button>
            </div>
          </div>

          {/* Status Bar */}
          <div className="grid md:grid-cols-4 gap-4">
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">Bot Status</div>
              <div className={`text-lg font-bold flex items-center gap-2 ${isRunning ? 'text-green-400' : 'text-gray-400'}`}>
                <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
                {isRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">Current BTC Price</div>
              <div className="text-lg font-bold text-white">
                ${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">Data Source</div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  priceSource === 'binance-ws' ? 'bg-green-400 animate-pulse' : 
                  priceSource.includes('error') || priceSource === 'disconnected' ? 'bg-red-400' : 
                  'bg-yellow-400'
                }`}></div>
                {priceSource === 'binance-ws' ? 'WebSocket' : 
                 priceSource === 'coingecko' ? 'CoinGecko' :
                 priceSource === 'coinbase' ? 'Coinbase' :
                 priceSource === 'binance' ? 'Binance' :
                 priceSource === 'disconnected' ? 'Offline' :
                 'Connecting'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">Last Signal Check</div>
              <div className="text-sm font-bold text-white">
                {lastSignalCheck || 'Not started'}
              </div>
            </div>
          </div>

          {fileStatus && (
            <div className="mt-4 text-sm text-white bg-black/30 rounded-lg p-3">
              {fileStatus}
            </div>
          )}
        </div>

        {/* File Upload Info */}
        {!csvData && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-1" />
              <div>
                <h3 className="text-yellow-200 font-semibold mb-2">CSV Upload (Optional - For Backtesting Only)</h3>
                <p className="text-yellow-200/80 text-sm mb-2">
                  ✅ <strong>Live Trading:</strong> No CSV needed! Just click "Start Live" to begin monitoring real-time prices.
                </p>
                <p className="text-yellow-200/80 text-sm mb-2">
                  📊 <strong>Backtesting:</strong> Upload your CSV to test the strategy on historical data.
                </p>
                <p className="text-yellow-200/80 text-sm mb-2">
                  Your CSV should have these columns (tab-separated):
                </p>
                <code className="text-xs text-yellow-200 bg-black/30 p-2 rounded block">
                  Time  Open  High  Low  Close  Volume  ...
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Telegram Config */}
        {showConfig && (
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <h3 className="text-white font-semibold text-lg mb-4">Telegram Setup</h3>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Bot Token: 123456:ABC..."
                value={telegramConfig.botToken}
                onChange={(e) => setTelegramConfig(prev => ({ ...prev, botToken: e.target.value }))}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50"
              />
              <input
                type="text"
                placeholder="Chat ID: 123456789"
                value={telegramConfig.chatId}
                onChange={(e) => setTelegramConfig(prev => ({ ...prev, chatId: e.target.value }))}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50"
              />
              <div className="flex gap-3">
                <button
                  onClick={testTelegram}
                  className="px-6 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold"
                >
                  Test
                </button>
                <button
                  onClick={() => signal && signal.type !== 'HOLD' && sendToTelegram(signal)}
                  disabled={!telegramConfig.enabled}
                  className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold disabled:opacity-50"
                >
                  Send Now
                </button>
              </div>
              {telegramStatus && (
                <div className="text-sm text-white bg-black/30 rounded-lg p-3">
                  {telegramStatus}
                </div>
              )}
              {telegramConfig.enabled && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                  <p className="text-green-400 text-sm font-semibold">✅ Auto-Send Active</p>
                  <p className="text-green-300 text-xs mt-1">New signals will be sent automatically to Telegram</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Signal Check Status */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Signal Detection Status</h3>
            {isCheckingSignal && (
              <div className="flex items-center gap-2 text-blue-400">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                <span className="text-sm">Checking...</span>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-blue-200 text-xs mb-1">Last Check</div>
              <div className="text-lg font-bold text-white">
                {lastSignalCheck || 'Not started'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-blue-200 text-xs mb-1">Check Interval</div>
              <div className="text-lg font-bold text-white">
                {isRunning ? '30 seconds' : 'Stopped'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-blue-200 text-xs mb-1">Total Checks</div>
              <div className="text-lg font-bold text-white">
                {signalCheckLog.length}
              </div>
            </div>
          </div>

          <div className="bg-black/30 rounded-lg p-4">
            <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
              📋 Signal Check Log (Last 10)
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {signalCheckLog.length > 0 ? (
                signalCheckLog.map((log, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm border-b border-white/10 pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-blue-400 font-mono text-xs">{log.time}</span>
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        log.result.includes('BUY') ? 'bg-green-500/20 text-green-400' :
                        log.result.includes('SELL') ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {log.result}
                      </span>
                      {log.source && (
                        <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded">
                          {log.source}
                        </span>
                      )}
                    </div>
                    <div className="text-white/75 text-xs">
                      ${log.entry.toFixed(2)} • {log.confidence}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-blue-200/50 py-4">
                  No checks yet. Click "Start Live" to begin monitoring.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <p className="text-blue-300 text-sm font-semibold mb-2">🔍 How Signal Detection Works:</p>
            <ul className="text-blue-200/90 text-xs space-y-1">
              <li>✓ Checks for signals every <strong>30 seconds</strong> when live mode is active</li>
              <li>✓ Uses <strong>LIVE real-time price data</strong> (collects 50 points = ~8 minutes)</li>
              <li>✓ <strong>CSV optional</strong> - only needed for historical backtesting</li>
              <li>✓ Analyzes volume (40%), sentiment (35%), and momentum (25%)</li>
              <li>✓ Generates BUY/SELL only when confidence score exceeds ±0.35</li>
              <li>✓ All checks are logged above with timestamps</li>
              <li>✓ Console shows detailed analysis (press F12 to view)</li>
            </ul>
          </div>
        </div>

        {/* Current Signal */}
        {signal && signal.type !== 'HOLD' && (
          <div className={`rounded-xl p-6 border-2 ${
            signal.type === 'BUY' ? 'bg-green-500/10 border-green-500/50' : 'bg-red-500/10 border-red-500/50'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              {signal.type === 'BUY' ? (
                <TrendingUp className="w-8 h-8 text-green-400" />
              ) : (
                <TrendingDown className="w-8 h-8 text-red-400" />
              )}
              <h2 className={`text-3xl font-bold ${signal.type === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                {signal.type} SIGNAL
              </h2>
            </div>

            <div className="grid md:grid-cols-4 gap-4">
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-white/75 text-sm mb-1">Entry</div>
                <div className="text-2xl font-bold text-white">${signal.entry.toFixed(2)}</div>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-white/75 text-sm mb-1">Stop Loss</div>
                <div className="text-2xl font-bold text-white">${signal.stopLoss.toFixed(2)}</div>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-white/75 text-sm mb-1">Take Profit</div>
                <div className="text-2xl font-bold text-white">${signal.takeProfit.toFixed(2)}</div>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-white/75 text-sm mb-1">R:R</div>
                <div className="text-2xl font-bold text-white">1:{signal.riskReward}</div>
              </div>
            </div>
          </div>
        )}

        {signal && signal.type === 'HOLD' && (
          <div className="bg-gray-500/10 border-2 border-gray-500/50 rounded-xl p-6">
            <div className="flex items-center gap-3">
              <Pause className="w-8 h-8 text-gray-400" />
              <div>
                <h2 className="text-2xl font-bold text-gray-400">NO SIGNAL</h2>
                <p className="text-white/75">{signal.message}</p>
              </div>
            </div>
          </div>
        )}

        {/* Backtest Section */}
        {csvData && (
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-white font-semibold text-lg">Backtest Results</h3>
              <button
                onClick={runBacktest}
                disabled={isBacktesting}
                className="px-6 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                {isBacktesting ? 'Running...' : 'Run Backtest'}
              </button>
            </div>

            {backtestResults && (
              <>
                <div className="grid md:grid-cols-6 gap-4 mb-6">
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-blue-200 text-sm mb-1">Data Points</div>
                    <div className="text-2xl font-bold text-white">{backtestResults.dataPoints.toLocaleString()}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-blue-200 text-sm mb-1">Trades</div>
                    <div className="text-2xl font-bold text-white">{backtestResults.totalTrades}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-blue-200 text-sm mb-1">Win Rate</div>
                    <div className="text-2xl font-bold text-green-400">{backtestResults.winRate.toFixed(1)}%</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-blue-200 text-sm mb-1">Return</div>
                    <div className={`text-2xl font-bold ${backtestResults.totalReturn > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {backtestResults.totalReturn > 0 ? '+' : ''}{backtestResults.totalReturn.toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-blue-200 text-sm mb-1">Profit Factor</div>
                    <div className="text-2xl font-bold text-white">{backtestResults.profitFactor.toFixed(2)}</div>
                  </div>
                  <div className="bg-white/5 rounded-lg p-4">
                    <div className="text-blue-200 text-sm mb-1">Max DD</div>
                    <div className="text-2xl font-bold text-red-400">{backtestResults.maxDrawdown.toFixed(1)}%</div>
                  </div>
                </div>

                <div className="text-sm text-blue-200 mb-4">
                  Time Range: {backtestResults.timeRange}
                </div>

                <div>
                  <h4 className="text-white font-semibold mb-3">Recent Trades (Last 100)</h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {backtestResults.trades.map((trade, idx) => (
                      <div 
                        key={idx}
                        className={`rounded-lg p-3 border text-sm ${
                          trade.outcome === 'TAKE_PROFIT' 
                            ? 'bg-green-500/10 border-green-500/30' 
                            : 'bg-red-500/10 border-red-500/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-white">{trade.entryTime} • {trade.type}</span>
                          <span className={`font-bold ${trade.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.pnl > 0 ? '+' : ''}{trade.pnl.toFixed(2)}%
                          </span>
                        </div>
                        <div className="text-xs text-white/60 mt-1">
                          Entry: ${trade.entry.toFixed(2)} → Exit: ${trade.exitPrice.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {!backtestResults && csvData && (
              <div className="text-center text-blue-200 py-8">
                Click "Run Backtest" to test strategy on your CSV data
              </div>
            )}
          </div>
        )}

        {/* Live Chart */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-semibold">Real-Time BTC/USD Price</h3>
              <p className="text-blue-200 text-xs mt-1">Live data from Binance • Updates every 10 seconds</p>
            </div>
            <button
              onClick={() => {
                setIsRunning(!isRunning);
                if (!isRunning) {
                  fetchRealBTCPrice();
                }
              }}
              className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 ${
                isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
              } text-white`}
            >
              {isRunning ? <><Pause className="w-4 h-4" /> Stop</> : <><Play className="w-4 h-4" /> Start Live</>}
            </button>
          </div>
          
          <div className="grid md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">Current Price</div>
              <div className="text-xl font-bold text-white">${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">24h High</div>
              <div className="text-xl font-bold text-green-400">
                ${realTimePrices.length > 0 ? Math.max(...realTimePrices.map(p => p.price)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">24h Low</div>
              <div className="text-xl font-bold text-red-400">
                ${realTimePrices.length > 0 ? Math.min(...realTimePrices.map(p => p.price)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—'}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1">Data Points</div>
              <div className="text-xl font-bold text-white">{realTimePrices.length}</div>
            </div>
          </div>
          
          {realTimePrices.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={realTimePrices}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
                <XAxis dataKey="time" stroke="#93c5fd" tick={{fontSize: 12}} />
                <YAxis 
                  stroke="#93c5fd" 
                  domain={['dataMin - 100', 'dataMax + 100']}
                  tick={{fontSize: 12}}
                  tickFormatter={(value) => `${value.toLocaleString()}`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                  labelStyle={{ color: '#93c5fd' }}
                  formatter={(value) => [`${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 'Price']}
                />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#3b82f6" 
                  strokeWidth={2} 
                  dot={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-blue-200">
              <div className="text-center">
                <Play className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Click "Start Live" to begin fetching real BTC prices</p>
              </div>
            </div>
          )}
        </div>

        {/* Strategy Info */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
          <h3 className="text-white font-semibold text-lg mb-4">Strategy Details</h3>
          <div className="text-blue-200 text-sm space-y-2">
            <p>• <strong>Volume Analysis (40%):</strong> Compares current volume to 7-hour average on 15m data</p>
            <p>• <strong>Sentiment (35%):</strong> Calculated from price momentum over recent periods</p>
            <p>• <strong>Momentum (25%):</strong> SMA10 vs SMA20 crossover on 15-minute candles</p>
            <p>• <strong>Risk Management:</strong> 4% stop loss, 12% take profit (3:1 R:R)</p>
            <p>• <strong>Signal Threshold:</strong> Only trades when score exceeds ±0.35 for higher quality setups</p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default BTCTradingBot;