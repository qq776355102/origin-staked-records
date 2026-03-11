/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import * as XLSX from 'xlsx';
import DatePicker from 'react-datepicker';
import "react-datepicker/dist/react-datepicker.css";
import { 
  Search, 
  Download, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  Clock, 
  Database, 
  User,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RPC_URL, CONTRACTS, DECIMALS, EVENT_ABIS, CATEGORIES } from './constants';

dayjs.extend(utc);
dayjs.extend(timezone);

const BEIJING_TZ = 'Asia/Shanghai';

// Helper to format block numbers as "QUANTITY" (no leading zeros)
const toQuantity = (value: number | bigint): string => {
  const hex = value.toString(16);
  return "0x" + (hex === "0" ? "0" : hex.replace(/^0+/, ''));
};

interface DepositRecord {
  user: string;
  amount: string;
  category: string;
  timestamp: number;
  hash: string;
  blockNumber: number;
  contract: string;
}

interface UserSummary {
  address: string;
  bond: number;
  staking600: number;
  flexible: number;
  records: DepositRecord[];
}

export default function App() {
  const [userAddressesInput, setUserAddressesInput] = useState<string>('');
  const [startDate, setStartDate] = useState<Date | null>(dayjs().subtract(8, 'hour').toDate());
  const [endDate, setEndDate] = useState<Date | null>(new Date());
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' });
  const [results, setResults] = useState<UserSummary[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [latestBlock, setLatestBlock] = useState<{ number: number; timestamp: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), []);
  const iface = useMemo(() => new ethers.Interface(EVENT_ABIS), []);

  useEffect(() => {
    const fetchLatest = async () => {
      try {
        const blockNum = await provider.getBlockNumber();
        const block = await provider.getBlock(blockNum);
        if (block) {
          setLatestBlock({ number: block.number, timestamp: Number(block.timestamp) });
        }
      } catch (err) {
        console.error("Failed to fetch latest block", err);
      }
    };
    fetchLatest();
  }, [provider]);

  const formatBeijingTime = (timestamp: number) => {
    return dayjs.unix(timestamp).tz(BEIJING_TZ).format('YYYY-MM-DD HH:mm:ss');
  };

  const estimateBlockHeight = async (date: Date) => {
    const targetTimestamp = dayjs(date).unix();
    if (!latestBlock) {
      const blockNum = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNum);
      if (!block) throw new Error("Could not fetch block");
      const avgBlockTime = 2.1; // Polygon avg
      const diff = Number(block.timestamp) - targetTimestamp;
      return Math.max(0, block.number - Math.floor(diff / avgBlockTime));
    } else {
      const avgBlockTime = 2.1;
      const diff = latestBlock.timestamp - targetTimestamp;
      return Math.max(0, latestBlock.number - Math.floor(diff / avgBlockTime));
    }
  };

  const scanBlocks = async () => {
    setError(null);
    setIsScanning(true);
    setResults([]);
    
    try {
      if (!startDate || !endDate) {
        throw new Error("请选择开始和结束时间");
      }

      const addresses = userAddressesInput
        .split(/[\n, ]+/)
        .map(a => a.trim())
        .filter(a => ethers.isAddress(a));

      if (addresses.length === 0) {
        throw new Error("请输入有效的用户地址");
      }

      const startBlock = await estimateBlockHeight(startDate);
      const endBlock = await estimateBlockHeight(endDate);
      
      const batchSize = 1000;
      const totalBlocks = Math.max(1, endBlock - startBlock);
      const allRecords: DepositRecord[] = [];

      // Event topics
      const stakedTopic = "0x9e71bc8eea02a63969f509818f2dafb9254532904319f9dbda79b67bd34a5f3d";
      const bondTopic = "0x4b3f81827ede20c81afbf1bb77b954afcdcae24d391d99042310cb1d9210dd57";

      const topics = [[stakedTopic, bondTopic]];
      // Add user addresses as the second topic (indexed parameter)
      const userTopics = addresses.map(a => ethers.zeroPadValue(ethers.getAddress(a), 32));
      topics.push(userTopics);

      const allContracts = [
        ...CONTRACTS.BOND,
        ...CONTRACTS.STAKING_600,
        ...CONTRACTS.FLEXIBLE
      ];

      for (let from = startBlock; from <= endBlock; from += batchSize) {
        const to = Math.min(from + batchSize - 1, endBlock);
        setProgress({ 
          current: from - startBlock, 
          total: totalBlocks, 
          message: `正在扫描区块 ${from} 到 ${to}...` 
        });

        const logs = await provider.send("eth_getLogs", [{
          fromBlock: toQuantity(from),
          toBlock: toQuantity(to),
          address: allContracts,
          topics: topics
        }]);

        const blockCache = new Map<number, any>();

        for (const log of logs) {
          try {
            const parsed = iface.parseLog(log);
            if (!parsed) continue;

            // Robust argument extraction
            let user = "";
            let amount = BigInt(0);
            let decimals = DECIMALS.LGNS;

            if (log.topics[0] === bondTopic) {
              // DepositToken(address indexed currency, address indexed user, uint256 amount)
              // currency (topic 1) is user address
              // user (topic 2) is currency type
              user = ethers.getAddress(ethers.dataSlice(log.topics[1], 12));
              const currencyType = ethers.dataSlice(log.topics[2], 12).toLowerCase();
              
              if (currencyType === "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063") {
                decimals = DECIMALS.DAI;
              } else {
                decimals = DECIMALS.LGNS;
              }
              amount = BigInt(log.data);
            } else {
              // Staked(address indexed user, uint256 amount) or Staked(address indexed staker, uint256 amount)
              user = ethers.getAddress(ethers.dataSlice(log.topics[1], 12));
              amount = BigInt(log.data);
              decimals = DECIMALS.LGNS;
            }
            
            if (!user) continue;

            let block = blockCache.get(Number(log.blockNumber));
            if (!block) {
              block = await provider.getBlock(Number(log.blockNumber));
              if (block) blockCache.set(Number(log.blockNumber), block);
            }
            
            let category = "未知";
            if (CONTRACTS.BOND.some(c => c.toLowerCase() === log.address.toLowerCase())) {
              category = CATEGORIES.BOND;
            } else if (CONTRACTS.STAKING_600.some(c => c.toLowerCase() === log.address.toLowerCase())) {
              category = CATEGORIES.STAKING_600;
            } else if (CONTRACTS.FLEXIBLE.some(c => c.toLowerCase() === log.address.toLowerCase())) {
              category = CATEGORIES.FLEXIBLE;
            }

            allRecords.push({
              user: user,
              amount: ethers.formatUnits(amount, decimals),
              category,
              timestamp: block ? Number(block.timestamp) : 0,
              hash: log.transactionHash,
              blockNumber: Number(log.blockNumber),
              contract: log.address
            });
          } catch (e) {
            console.error("Error parsing log", e);
          }
        }
      }

      // Aggregate
      const summaryMap = new Map<string, UserSummary>();
      addresses.forEach(addr => {
        const checksumAddr = ethers.getAddress(addr);
        summaryMap.set(checksumAddr, {
          address: checksumAddr,
          bond: 0,
          staking600: 0,
          flexible: 0,
          records: []
        });
      });

      allRecords.forEach(rec => {
        const summary = summaryMap.get(rec.user);
        if (summary) {
          summary.records.push(rec);
          const amt = parseFloat(rec.amount);
          if (rec.category === CATEGORIES.BOND) summary.bond += amt;
          if (rec.category === CATEGORIES.STAKING_600) summary.staking600 += amt;
          if (rec.category === CATEGORIES.FLEXIBLE) summary.flexible += amt;
        }
      });

      setResults(Array.from(summaryMap.values()));
      setProgress({ current: totalBlocks, total: totalBlocks, message: '扫描完成！' });
    } catch (err: any) {
      setError(err.message || "扫描过程中发生错误");
    } finally {
      setIsScanning(false);
    }
  };

  const exportToExcel = (userSummary?: UserSummary) => {
    const dataToExport = userSummary 
      ? userSummary.records 
      : results.flatMap(r => r.records);

    const worksheet = XLSX.utils.json_to_sheet(dataToExport.map(r => ({
      '用户地址': r.user,
      '类型': r.category,
      '金额': parseFloat(r.amount).toFixed(2),
      '北京时间': formatBeijingTime(r.timestamp),
      '区块高度': r.blockNumber,
      '交易哈希': r.hash,
      '合约地址': r.contract
    })));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "存款详情");
    XLSX.writeFile(workbook, `存款记录_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <Database className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">Polygon 存款扫描器</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Blockchain Data Explorer</p>
            </div>
          </div>
          
          {latestBlock && (
            <div className="hidden md:flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-gray-600 font-medium">最新区块: {latestBlock.number}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full border border-gray-100">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-600 font-medium">{formatBeijingTime(latestBlock.timestamp)}</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Panel: Configuration */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Search className="w-4 h-4" /> 扫描配置
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">用户地址 (每行一个)</label>
                  <textarea
                    className="w-full h-32 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none text-sm font-mono"
                    placeholder="0x...&#10;0x..."
                    value={userAddressesInput}
                    onChange={(e) => setUserAddressesInput(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-emerald-600" /> 开始时间
                    </label>
                    <div className="relative">
                      <DatePicker
                        selected={startDate}
                        onChange={(date) => setStartDate(date)}
                        showTimeSelect
                        timeFormat="HH:mm"
                        timeIntervals={15}
                        dateFormat="yyyy-MM-dd HH:mm:ss"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-emerald-600" /> 结束时间
                    </label>
                    <div className="relative">
                      <DatePicker
                        selected={endDate}
                        onChange={(date) => setEndDate(date)}
                        showTimeSelect
                        timeFormat="HH:mm"
                        timeIntervals={15}
                        dateFormat="yyyy-MM-dd HH:mm:ss"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none text-sm"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={scanBlocks}
                  disabled={isScanning}
                  className={`w-full py-3.5 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                    isScanning 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] shadow-emerald-200'
                  }`}
                >
                  {isScanning ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      正在扫描...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      开始全量扫描
                    </>
                  )}
                </button>
              </div>
            </section>

            {isScanning && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-100"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-emerald-700">扫描进度</span>
                  <span className="text-xs font-bold text-emerald-500">
                    {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2 mb-3 overflow-hidden">
                  <motion.div 
                    className="bg-emerald-500 h-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 italic truncate">{progress.message}</p>
              </motion.div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 font-medium">{error}</p>
              </div>
            )}
          </div>

          {/* Right Panel: Results */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px]">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  扫描结果
                  <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                    {results.length} 个地址
                  </span>
                </h2>
                {results.length > 0 && (
                  <button
                    onClick={() => exportToExcel()}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
                  >
                    <Download className="w-4 h-4" /> 导出全部
                  </button>
                )}
              </div>

              {results.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[500px] text-gray-400">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                    <Search className="w-10 h-10 text-gray-200" />
                  </div>
                  <p className="text-lg font-medium">暂无数据</p>
                  <p className="text-sm">请输入地址并点击开始扫描</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {results.map((user) => (
                    <div key={user.address} className="group">
                      <div 
                        className={`px-6 py-5 flex items-center justify-between cursor-pointer transition-all hover:bg-gray-50/80 ${expandedUser === user.address ? 'bg-emerald-50/30' : ''}`}
                        onClick={() => setExpandedUser(expandedUser === user.address ? null : user.address)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                            <User className="w-5 h-5 text-gray-400 group-hover:text-emerald-600" />
                          </div>
                          <div>
                            <p className="text-sm font-mono font-bold text-gray-900">{user.address}</p>
                            <div className="flex gap-3 mt-1">
                              <span className="text-[10px] font-bold uppercase tracking-tighter px-2 py-0.5 bg-amber-50 text-amber-600 rounded border border-amber-100">
                                债券: {user.bond.toFixed(2)}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-tighter px-2 py-0.5 bg-purple-50 text-purple-600 rounded border border-purple-100">
                                600天: {user.staking600.toFixed(2)}
                              </span>
                              <span className="text-[10px] font-bold uppercase tracking-tighter px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded border border-emerald-100">
                                活期: {user.flexible.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              exportToExcel(user);
                            }}
                            className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                            title="导出此用户"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {expandedUser === user.address ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                        </div>
                      </div>

                      <AnimatePresence>
                        {expandedUser === user.address && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden bg-white"
                          >
                            <div className="px-6 pb-6">
                              <div className="overflow-x-auto rounded-xl border border-gray-100">
                                <table className="w-full text-left text-sm">
                                  <thead className="bg-gray-50 text-gray-500 font-semibold text-xs uppercase tracking-wider">
                                    <tr>
                                      <th className="px-4 py-3">类型</th>
                                      <th className="px-4 py-3">金额</th>
                                      <th className="px-4 py-3">北京时间</th>
                                      <th className="px-4 py-3">哈希</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {user.records.length === 0 ? (
                                      <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400 italic">
                                          该时间段内无存款记录
                                        </td>
                                      </tr>
                                    ) : (
                                      user.records.map((rec, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                                          <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                              rec.category === CATEGORIES.BOND ? 'bg-amber-100 text-amber-700' :
                                              rec.category === CATEGORIES.STAKING_600 ? 'bg-purple-100 text-purple-700' :
                                              'bg-emerald-100 text-emerald-700'
                                            }`}>
                                              {rec.category}
                                            </span>
                                          </td>
                                          <td className="px-4 py-3 font-mono font-bold text-gray-700">
                                            {parseFloat(rec.amount).toFixed(2)}
                                          </td>
                                          <td className="px-4 py-3 text-gray-500 text-xs">
                                            {formatBeijingTime(rec.timestamp)}
                                          </td>
                                          <td className="px-4 py-3">
                                            <a 
                                              href={`https://polygonscan.com/tx/${rec.hash}`} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="text-emerald-600 hover:text-emerald-700 flex items-center gap-1 group/link"
                                            >
                                              <span className="font-mono text-[10px]">{rec.hash.slice(0, 6)}...{rec.hash.slice(-4)}</span>
                                              <ExternalLink className="w-3 h-3 opacity-0 group-hover/link:opacity-100 transition-opacity" />
                                            </a>
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 border-t border-gray-200 mt-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 text-gray-400">
            <Database className="w-5 h-5" />
            <span className="text-sm font-medium">Polygon Network Scanner v1.0</span>
          </div>
          <div className="flex gap-8 text-sm text-gray-500 font-medium">
            <span className="hover:text-emerald-600 cursor-pointer transition-colors">API Status</span>
            <span className="hover:text-emerald-600 cursor-pointer transition-colors">Documentation</span>
            <span className="hover:text-emerald-600 cursor-pointer transition-colors">Support</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
