import React, { useState, useEffect } from 'react';
import { 
  Video, Users, Cpu, HardDrive, ArrowDown, ArrowUp, Activity, Wifi 
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { getMockMetrics } from '../lib/rtsp-mock';
import { getStreams } from '../lib/storage';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}

function MetricCard({ title, value, icon: Icon, color, subtitle }: MetricCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">{title}</span>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      {/* Network Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-950/50 text-cyan-400">
            <ArrowDown className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Входящий трафик</p>
            <p className="text-lg font-bold text-white">{metrics.networkIn} Мбит/с</p>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-950/50 text-orange-400">
            <ArrowUp className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Исходящий трафик</p>
            <p className="text-lg font-bold text-white">{metrics.networkOut} Мбит/с</p>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-950/50 text-emerald-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm text-gray-400">Время работы</p>
            <p className="text-lg font-bold text-white">{formatUptime(metrics.uptime)}</p>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* CPU/RAM Chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-medium text-gray-300">Загрузка системы</h3>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#6B7280" fontSize={10} />
                <YAxis stroke="#6B7280" fontSize={10} domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Area type="monotone" dataKey="cpu" stroke="#EAB308" fill="#EAB308" fillOpacity={0.1} name="CPU %" />
                <Area type="monotone" dataKey="ram" stroke="#A855F7" fill="#A855F7" fillOpacity={0.1} name="RAM %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Network Chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Wifi className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-medium text-gray-300">Сетевой трафик</h3>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={networkHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#6B7280" fontSize={10} />
                <YAxis stroke="#6B7280" fontSize={10} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Line type="monotone" dataKey="in" stroke="#06B6D4" strokeWidth={2} dot={false} name="Вход Мбит/с" />
                <Line type="monotone" dataKey="out" stroke="#F97316" strokeWidth={2} dot={false} name="Выход Мбит/с" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Stream Status Summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Статус потоков</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {streams.map(stream => (
            <div key={stream.id} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
              <div className={`w-2.5 h-2.5 rounded-full ${
                stream.status === 'online' ? 'bg-green-500' :
                stream.status === 'reconnecting' ? 'bg-yellow-500 animate-pulse' :
                'bg-red-500'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{stream.name}</p>
                <p className="text-xs text-gray-500">{stream.status === 'online' ? 'Активен' : stream.status === 'reconnecting' ? 'Переподключение' : 'Отключён'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
