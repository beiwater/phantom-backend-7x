// 把游戏事件映射为音效。战斗音效通过包装 RTS 特效调用获得位置(特效只在视野内触发)。
export function bindSounds({ game, rts, rig, audio }) {
  const ev = game.events;
  const mine = (b) => b.team === game.localPlayer;
  ev.on('building:add', (b) => { if (mine(b)) audio.play('place'); });
  ev.on('building:done', (b) => { if (mine(b)) audio.play('done'); });
  ev.on('produce', ({ b, out }) => { if (mine(b) && out.money) audio.play('coin', 0.6); });
  ev.on('tech', (id) => { if (id) audio.play('tech'); });
  ev.on('era', () => audio.play('win'));
  ev.on('wave:incoming', () => audio.play('alarm'));
  ev.on('gameover', ({ result }) => audio.play(result === 'win' ? 'win' : 'lose'));
  ev.on('building:remove', ({ b, destroyed }) => { if (destroyed) audio.playAt('boom', b.x + b.w / 2, b.z + b.d / 2, rig); });
  ev.on('unit:trained', () => audio.play('done', 0.5));
  ev.on('ruins:claim', () => audio.play('tech'));
  ev.on('contract:done', () => audio.play('coin'));

  const fx = rts.fx;
  if (fx) {
    const wrap = (name, sound, pick) => {
      const orig = fx[name].bind(fx);
      fx[name] = (...args) => {
        const p = pick(...args);
        if (p) audio.playAt(sound, p.x, p.z, rig);
        return orig(...args);
      };
    };
    wrap('tracer', 'shot', (a) => a);
    wrap('projectile', 'cannon', (a) => a);
    wrap('explode', 'boom', (x, y, z, n) => (n >= 8 ? { x, z } : null));
  }
  document.getElementById('toolbar').addEventListener('click', (e) => { if (e.target.closest('button')) audio.play('click'); });
}
