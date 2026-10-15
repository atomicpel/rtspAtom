import { Computer } from './types';

export interface ComputerStatus {
  computerId: string;
  status: 'online' | 'offline' | 'reconnecting';
  streamCount: number;
  activeStreams: number;
  clients: number;
  uptime: number;
}

const mockStatuses: Record<string, ComputerStatus> = {};

export function initializeRtspMock(computers: Computer[]): void {
  computers.forEach(computer => {
    if (!mockStatuses[computer.id]) {
      const activeStreams = computer.streams.filter((s: any) => s.isActive).length;
      mockStatuses[computer.id] = {
        computerId: computer.id,
        status: computer.isActive ? 'online' : 'offline',
        streamCount: computer.streams.length,
        activeStreams,
        clients: computer.isActive ? Math.floor(Math.random() * 3) : 0,
        uptime: computer.isActive ? Math.floor(Math.random() * 86400) : 0,
      };
    }
  });
}

export function getMockMetrics() {
  const statuses = Object.values(mockStatuses);
  const activeComputers = statuses.filter(s => s.status === 'online').length;
  const totalClients = statuses.reduce((sum, s) => sum + s.clients, 0);
  const totalStreams = statuses.reduce((sum, s) => sum + s.activeStreams, 0);
  
  return {
    cpu: Math.floor(Math.random() * 30) + 10,
    ram: Math.floor(Math.random() * 40) + 30,
    networkIn: Math.floor(Math.random() * 50) + 20,
    networkOut: Math.floor(Math.random() * 100) + 50,
    activeComputers,
    connectedClients: totalClients,
    totalStreams,
    uptime: 86400 + Math.floor(Math.random() * 10000),
  };
}
