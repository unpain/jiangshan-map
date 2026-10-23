<script lang="ts">
import { useAtlas } from '../context';
const atlas = useAtlas();
</script>

<header id="nav-bar">
      <div class="brand-group">
        <h1 id="site-heading">
          <span class="seal-mark" id="txt-seal">江山时序</span>
          <span class="subtitle-mark" id="txt-subtitle">中国历史地图 · 战国 → 今</span>
        </h1>
      </div>
      <div class="control-strip" role="toolbar" aria-label="地图图层与交互模式">
        <button id="act-layers-menu" class="action-btn subtle layers-trigger-btn" type="button" aria-expanded="false" aria-controls="layers-popover" title="展开或收起地图图层开关">
          <svg class="btn-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 1.8L1.5 5.2 8 8.6l6.5-3.4L8 1.8zM1.5 8.2L8 11.6l6.5-3.4M1.5 11.2L8 14.6l6.5-3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="lbl-layers-btn">图层</span>
          <span class="caret-mark" aria-hidden="true">▾</span>
        </button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="music-pill-group" role="group" aria-label="古琴雅乐">
          <button id="act-music" onclick={() => atlas.toggleMusic()} class="action-btn subtle music-btn" title="播放 / 暂停古琴雅乐">
            <svg class="btn-svg music-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M6 12.2V3.5l7-1.5v8.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="4.3" cy="12.2" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>
              <circle cx="11.3" cy="10.7" r="1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>
            </svg>
            <span id="lbl-music">雅乐</span>
          </button>
          <button id="act-music-next" onclick={() => atlas.nextMusicTrack()} class="action-btn subtle music-next-btn is-hidden" title="切换下一首古琴曲" aria-label="切换下一首古琴曲">
            <svg class="btn-svg" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <polygon points="3.5,3.2 10.2,8 3.5,12.8" fill="currentColor"/>
              <line x1="12.2" y1="3.2" x2="12.2" y2="12.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <button id="act-switch-framework" onclick={() => atlas.switchFramework('vue')} class="action-btn subtle" type="button" title="切换到 Vue / Switch to Vue">Vue</button>
        <button id="act-locale" onclick={() => atlas.toggleLocale()} class="action-btn subtle locale-switch" title="Switch language / 切换中英文">
          <svg class="btn-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><ellipse cx="8" cy="8" rx="2.8" ry="6.2" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.2"/></svg>
          <span id="lbl-locale">EN</span>
        </button>
        <a id="act-github-star" class="action-btn subtle github-star-btn" href="https://github.com/unpain/jiangshan-map" target="_blank" rel="noopener noreferrer" title="在 GitHub 上为「江山时序」点亮 Star" aria-label="Star on GitHub">
          <svg class="btn-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
          <span class="star-mark" aria-hidden="true">★</span>
          <span id="lbl-github-star">Star</span>
        </a>
      </div>

      <div id="layers-popover" class="layers-popover is-hidden" role="dialog" aria-label="地图图层开关">
        <div class="layers-pop-section">
          <div class="layers-pop-heading" id="txt-layer-grp-hist">历史舆图要素</div>
          <div class="layers-pop-grid">
            <label class="layer-chip"><input type="checkbox" id="chk-polities" checked /><span id="lbl-polities">历史疆域</span></label>
            <label class="layer-chip"><input type="checkbox" id="chk-prefectures" checked /><span id="lbl-prefectures">州道政区</span></label>
            <label class="layer-chip"><input type="checkbox" id="chk-settlements" checked /><span id="lbl-settlements">古地名</span></label>
            <label class="layer-chip" title="名关雄隘 · 长城 · 大运河 · 丝绸之路"><input type="checkbox" id="chk-corridors" checked /><span id="lbl-corridors">关河丝路</span></label>
            <label class="layer-chip"><input type="checkbox" id="chk-milestones" checked /><span id="lbl-milestones">重大事件</span></label>
          </div>
        </div>
        <div class="layers-pop-section">
          <div class="layers-pop-heading" id="txt-layer-grp-mod">山川与现代参照</div>
          <div class="layers-pop-grid">
            <label class="layer-chip"><input type="checkbox" id="chk-terrain" checked /><span id="lbl-terrain-chk">山川水系</span></label>
            <label class="layer-chip"><input type="checkbox" id="chk-provinces" checked /><span id="lbl-provinces">现代省界</span></label>
            <label class="layer-chip"><input type="checkbox" id="chk-prov-names" /><span id="lbl-prov-names">现代省名</span></label>
          </div>
        </div>
      </div>
    </header>
