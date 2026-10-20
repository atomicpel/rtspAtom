export type Platform = 'linux' | 'windows';

/** Команды обслуживания для подсказок в интерфейсе — зависят от ОС сервера. */
export function hints(p: Platform | undefined) {
  if (p === 'windows') {
    return {
      osName: 'Windows',
      createAdmin: 'rtspatom-admin create-admin',
      adminShell: 'в командной строке, запущенной от имени администратора',
      mediamtxStatus: 'Службы Windows → «RTSP Atom MediaMTX»',
      configFile: 'C:\\ProgramData\\RTSPAtom\\config.json',
      installTls: 'install.cmd -Tls',
      restart: 'Restart-Service rtspatom',
      logs: 'C:\\ProgramData\\RTSPAtom\\logs',
    };
  }
  return {
    osName: 'Astra Linux',
    createAdmin: 'sudo rtspatom-admin create-admin',
    adminShell: 'в терминале сервера',
    mediamtxStatus: 'systemctl status rtspatom-mediamtx',
    configFile: '/etc/rtspatom/config.json',
    installTls: 'sudo ./install.sh --tls',
    restart: 'systemctl restart rtspatom',
    logs: 'journalctl -u rtspatom',
  };
}
