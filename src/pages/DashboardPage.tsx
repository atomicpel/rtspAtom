import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Video, Users, Cpu, HardDrive, ArrowDown, ArrowUp, Activity, Wifi, TrendingUp
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { getMockMetrics } from '../lib/rtsp-mock';
import { getStreams } from '../lib/storage';
import { AnimatedCard, StaggerContainer, StaggerItem } from '../components/AnimatedCard';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
  delay?: number;
}

function MetricCard({ title, value, icon: Icon, color, subtitle, delay = 0 }: MetricCardProps) {
  return (
    <StaggerItem>
      <AnimatedCard className="p-5 group">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-gray-400">{title}</span>
          <motion.div 
            whileHover={{ scale: 1.2, rotate: 10 }}
            className={`p-2.5 rounded-xl ${color} shadow-lg`}
          >
            <Icon className="w-5 h-5" />
          </motion.div>
        </div>
        <motion.p 
          key={value}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-3xl font-bold text-white"
        >
          {value}
        </motion.p>
        {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        <motion.div 
          className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />
      </AnimatedCard>
    </StaggerItem>
  );
}

export function DashboardPage() {
  const [metrics, setMetrics] = useState(getMockMetrics());
  const [cpuHistory, setCpuHistory] = useState<Array<{ time: string; cpu: number; ram: number }>>([]);
  const [networkHistory, setNetworkHistory] = useState<Array<{ time: string; in: number; out: number }>>([]);
  const streams = getStreams();

  useEffect(() => {
    const interval = setInterval(() => {
      const newMetrics = getMockMetrics();
      setMetrics(newMetrics);

      const now = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      setCpuHistory(prev => {
        const next = [...prev, { time: now, cpu: newMetrics.cpu, ram: newMetrics.ram }];
        return next.slice(-20);
      });

      setNetworkHistory(prev => {
        const next = [...prev, { time: now, in: newMetrics.networkIn, out: newMetrics.networkOut }];
        return next.slice(-20);
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}д ${hours}ч ${mins}м`;
  };

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="Активные потоки" 
          value={metrics.activeStreams}
          icon={Video}
          color="bg-blue-950/50 text-blue-400"
          subtitle={`из ${streams.length} настроенных`}
        />
        <MetricCard 
          title="Подключённые клиенты" 
          value={metrics.connectedClients}
          icon={Users}
          color="bg-green-950/50 text-green-400"
          subtitle="текущие сессии"
        />
        <MetricCard 
          title="CPU" 
          value={`${metrics.cpu}%`}
          icon={Cpu}
          color="bg-yellow-950/50 text-yellow-400"
          subtitle="загрузка процессора"
        />
        <MetricCard 
          title="RAM" 
          value={`${metrics.ram}%`}
          icon={HardDrive}
          color="bg-purple-950/50 text-purple-400"
          subtitle="использование памяти"
        />
      </StaggerContainer>

      {/* Network Stats */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StaggerItem>
          <AnimatedCard className="p-4 flex items-center gap-3">
            <motion.div 
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="p-2.5 rounded-xl bg-cyan-950/50 text-cyan-400"
            >
              <ArrowDown className="w-5 h-5" />
            </motion.div>
            <div>
              <p className="text-sm text-gray-400">Входящий трафик</p>
              <motion.p 
                key={metrics.networkIn}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                className="text-xl font-bold text-white"
              >
                {metrics.networkIn} Мбит/с
              </motion.p>
            </div>
          </AnimatedCard>
        </StaggerItem>
        <StaggerItem>
          <AnimatedCard className="p-4 flex items-center gap-3">
            <motion.div 
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
              className="p-2.5 rounded-xl bg-orange-950/50 text-orange-400"
            >
              <ArrowUp className="w-5 h-5" />
            </motion.div>
            <div>
              <p className="text-sm text-gray-400">Исходящий трафик</p>
              <motion.p 
                key={metrics.networkOut}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                className="text-xl font-bold text-white"
              >
                {metrics.networkOut} Мбит/с
              </motion.p>
            </div>
          </AnimatedCard>
        </StaggerItem>
        <StaggerItem>
          <AnimatedCard className="p-4 flex items-center gap-3">
            <motion.div 
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
              className="p-2.5 rounded-xl bg-emerald-950/50 text-emerald-400"
            >
              <Activity className="w-5 h-5" />
            </motion.div>
            <div>
              <p className="text-sm text-gray-400">Время работы</p>
              <p className="text-xl font-bold text-white">{formatUptime(metrics.uptime)}</p>
            </div>
          </AnimatedCard>
        </StaggerItem>
      </StaggerContainer>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CPU/RAM Chart */}
        <AnimatedCard className="p-5" delay={0.2}>
          <div className="flex items-center gap-2 mb-4">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Cpu className="w-4 h-4 text-yellow-400" />
            </motion.div>
            <h3 className="text-sm font-medium text-gray-300">Загрузка системы</h3>
            <TrendingUp className="w-4 h-4 text-green-400 ml-auto" />
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuHistory}>
                <defs>
                  <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EAB308" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#EAB308" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="ramGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#A855F7" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#A855F7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="time" stroke="#6B7280" fontSize={10} />
                <YAxis stroke="#6B7280" fontSize={10} domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(17, 24, 39, 0.95)', 
                    border: '1px solid rgba(59, 130, 246, 0.3)', 
                    borderRadius: '12px',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                  }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Area type="monotone" dataKey="cpu" stroke="#EAB308" fill="url(#cpuGradient)" strokeWidth={2} name="CPU %" />
                <Area type="monotone" dataKey="ram" stroke="#A855F7" fill="url(#ramGradient)" strokeWidth={2} name="RAM %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </AnimatedCard>

        {/* Network Chart */}
        <AnimatedCard className="p-5" delay={0.3}>
          <div className="flex items-center gap-2 mb-4">
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Wifi className="w-4 h-4 text-cyan-400" />
            </motion.div>
            <h3 className="text-sm font-medium text-gray-300">Сетевой трафик</h3>
            <TrendingUp className="w-4 h-4 text-green-400 ml-auto" />
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={networkHistory}>
                <defs>
                  <linearGradient id="inGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#06B6D4"/>
                    <stop offset="100%" stopColor="#3B82F6"/>
                  </linearGradient>
                  <linearGradient id="outGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#F97316"/>
                    <stop offset="100%" stopColor="#EF4444"/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="time" stroke="#6B7280" fontSize={10} />
                <YAxis stroke="#6B7280" fontSize={10} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'rgba(17, 24, 39, 0.95)', 
                    border: '1px solid rgba(59, 130, 246, 0.3)', 
                    borderRadius: '12px',
                    backdropFilter: 'blur(10px)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                  }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Line type="monotone" dataKey="in" stroke="url(#inGradient)" strokeWidth={2.5} dot={false} name="Вход Мбит/с" />
                <Line type="monotone" dataKey="out" stroke="url(#outGradient)" strokeWidth={2.5} dot={false} name="Выход Мбит/с" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </AnimatedCard>
      </div>

      {/* Stream Status Summary */}
      <AnimatedCard className="p-5" delay={0.4}>
        <h3 className="text-sm font-medium text-gray-300 mb-3">Статус потоков</h3>
        <StaggerContainer className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {streams.map((stream, index) => (
            <StaggerItem key={stream.id}>
              <motion.div 
                whileHover={{ scale: 1.02, x: 4 }}
                className="flex items-center gap-3 p-3 bg-gray-800/30 rounded-xl border border-gray-700/30 hover:border-blue-500/30 transition-all group"
              >
                <motion.div 
                  animate={{ 
                    scale: stream.status === 'online' ? [1, 1.3, 1] : 1,
                    opacity: stream.status === 'reconnecting' ? [1, 0.5, 1] : 1
                  }}
                  transition={{ duration: stream.status === 'online' ? 2 : 1, repeat: Infinity }}
                  className={`w-3 h-3 rounded-full ${
                    stream.status === 'online' ? 'bg-green-500 shadow-lg shadow-green-500/50' :
                    stream.status === 'reconnecting' ? 'bg-yellow-500 shadow-lg shadow-yellow-500/50' :
                    'bg-red-500 shadow-lg shadow-red-500/50'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate group-hover:text-blue-400 transition-colors">{stream.name}</p>
                  <p className="text-xs text-gray-500">{stream.status === 'online' ? 'Активен' : stream.status === 'reconnecting' ? 'Переподключение' : 'Отключён'}</p>
                </div>
              </motion.div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </AnimatedCard>
    </div>
  );
}
