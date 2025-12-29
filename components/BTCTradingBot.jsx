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

  // Trading strategy
  const generateSignalFromData = (currentData, historicalWindow) => {
    if (!historicalWindow || historicalWindow.length < 20) return null;
    
    let score = 0;
    
    // Volume analysis (40% weight)
    if (currentData.volumeChange > 50) {
      score += 0.4;
    } else if (currentData.volumeChange > 25) {
      score += 0.2;
    } else if (currentData.volumeChange < -30) {
      score -= 0.4;
    } else if (currentData.volumeChange < -15) {
      score -= 0.2;
    }
    
    // Sentiment analysis (35% weight)
    score += currentData.sentiment * 0.35;
    
    // Momentum analysis (25% weight) - SMA crossover
    const prices = historicalWindow.slice(-40).map(d => d.close);
    if (prices.length >= 40) {
      const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
      const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
      
      if (sma10 > sma20 * 1.005) {
        score += 0.25;
      } else if (sma10 < sma20 * 0.995) {
        score -= 0.25;
      }
    }
    
    // Generate signal with strict threshold
    if (score > 0.35) {
      const entry = currentData.close;
      const stopLoss = entry * 0.96; // 4% stop loss
      const takeProfit = entry * 1.12; // 12% take profit
      
      return {
        type: 'BUY',
        entry: entry,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        score: score
      };
    } else if (score < -0.35) {
      const entry = currentData.close;
      const stopLoss = entry * 1.04; // 4% stop loss
      const takeProfit = entry * 0.88; // 12% take profit
      
      return {
        type: 'SELL',
        entry: entry,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        score: score
      };
    }
    
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

  // Send to Telegram
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

  // Generate current signal
  const generateCurrentSignal = () => {
    if (!csvData || csvData.length < 50) {
      setSignal({ type: 'HOLD', message: 'Upload CSV file to generate signals' });
      return;
    }

    const recentData = csvData.slice(-50);
    const currentData = recentData[recentData.length - 1];
    
    const signal = generateSignalFromData(currentData, recentData);
    
    if (signal) {
      setSignal({
        ...signal,
        riskReward: ((signal.takeProfit - signal.entry) / Math.abs(signal.entry - signal.stopLoss)).toFixed(2),
        volumeChange: currentData.volumeChange,
        sentiment: currentData.sentiment
      });
    } else {
      setSignal({ 
        type: 'HOLD',
        message: 'No clear signal - waiting for better setup'
      });
    }
  };

  // Initialize
  useEffect(() => {
    const initial = [];
    for (let i = 20; i >= 0; i--) {
      initial.push({
        time: new Date(Date.now() - i * 180000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        price: REAL_BTC_PRICE + (Math.random() - 0.5) * 1000
      });
    }
    setPriceHistory(initial);
  }, []);

  // Update signal when CSV loads
  useEffect(() => {
    if (csvData) {
      generateCurrentSignal();
    }
  }, [csvData]);

  // Auto-send signal to Telegram when signal changes
  useEffect(() => {
    if (!signal || signal.type === 'HOLD' || !telegramConfig.enabled) return;
    
    // Check if this is a new signal (different from last sent)
    const signalKey = `${signal.type}-${signal.entry.toFixed(0)}`;
    
    if (signalKey !== lastSentSignal) {
      console.log('New signal detected, sending to Telegram:', signalKey);
      sendToTelegram(signal);
      setLastSentSignal(signalKey);
    }
  }, [signal, telegramConfig.enabled]);

  // Live updates
  useEffect(() => {
    if (!isRunning) return;
    
    const interval = setInterval(() => {
      setCurrentPrice(prev => {
        const change = (Math.random() - 0.5) * 200;
        const newPrice = prev + change;
        
        setPriceHistory(prevHistory => {
          const updated = [...prevHistory, {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            price: newPrice
          }];
          return updated.slice(-20);
        });
        
        return newPrice;
      });
      
      // Regenerate signal periodically when live mode is running
      if (Math.random() > 0.7 && csvData) {
        generateCurrentSignal();
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isRunning, csvData]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 border border-white/20">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
                BTC/USD Trading Bot
              </h1>
              <p className="text-blue-200 text-sm">
                Upload 15m CSV • Real Data Backtesting • Telegram Alerts
              </p>
            </div>
            <div className="flex gap-3 items-center">
              <label className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold cursor-pointer flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload CSV
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
                <h3 className="text-yellow-200 font-semibold mb-2">Upload Your BTC CSV File</h3>
                <p className="text-yellow-200/80 text-sm mb-2">
                  Your CSV should have these columns (tab-separated):
                </p>
                <code className="text-xs text-yellow-200 bg-black/30 p-2 rounded block">
                  Time  Open  High  Low  Close  Volume  ...
                </code>
                <p className="text-yellow-200/80 text-sm mt-2">
                  The bot will analyze volume patterns, calculate sentiment from price action, 
                  and run comprehensive backtesting on your real data.
                </p>
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
            <h3 className="text-white font-semibold">Live Price Simulation</h3>
            <button
              onClick={() => setIsRunning(!isRunning)}
              className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 ${
                isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
              } text-white`}
            >
              {isRunning ? <><Pause className="w-4 h-4" /> Pause</> : <><Play className="w-4 h-4" /> Start</>}
            </button>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={priceHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff20" />
              <XAxis dataKey="time" stroke="#93c5fd" />
              <YAxis stroke="#93c5fd" domain={['auto', 'auto']} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                labelStyle={{ color: '#93c5fd' }}
              />
              <Line type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
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