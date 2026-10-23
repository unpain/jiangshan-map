<script setup lang="ts">
import { useAtlas } from '../composables/useAtlas';
const atlas = useAtlas();
</script>

<template>
<div id="viewport-frame">
        <div id="leaflet-map" role="region" aria-label="中国历史地图"></div>

        <div id="map-search-box" role="search" aria-label="快速检索历史人物、古今地名、州府、帝王年号与舆图寻址挑战">
          <div class="search-input-wrap">
            <svg class="search-ico" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10.6 10.6L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <input id="inp-map-search" type="search" autocomplete="off" placeholder="搜人物 / 古今地名 / 州府 / 年号" aria-label="搜历史人物、古今地名、州府或帝王年号" />
          </div>
          <ul id="map-search-results" class="search-results-list is-hidden" role="listbox"></ul>
        </div>

        <div id="map-key" aria-live="polite"></div>

        <div id="canvas-br-dock">
          <button id="act-reset-camera" @click="atlas.resetCamera()" class="canvas-reset-btn" type="button" title="复位视图">
            <svg class="btn-svg" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>
            <span id="lbl-reset-camera">复位视图</span>
          </button>
          <div id="scale-bar-box" aria-hidden="true">
            <div class="scale-label" id="scale-label-text">500 km</div>
            <div class="scale-ruler" id="scale-ruler-bar"></div>
          </div>
        </div>

        <button id="act-toggle-pane" type="button" title="收起编年侧栏（全屏看图）" aria-label="收起或展开编年侧栏"><span class="tp-arrow" aria-hidden="true">›</span><span class="tp-label" id="lbl-toggle-pane">全图</span></button>

        <div id="challenge-card" class="is-hidden" role="region" aria-label="古地名挑战">
          <div class="challenge-top">
            <span id="txt-challenge-kicker" class="mode-pill is-active">舆图寻址</span>
            <span id="challenge-step" class="pill-badge">第 1 / 10 题</span>
            <span id="challenge-points" class="score-readout">得分 0</span>
            <button id="act-close-challenge" class="icon-close" title="退出挑战" aria-label="退出挑战">
              <svg class="ico-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div id="challenge-question" class="challenge-prompt"></div>
          <div id="challenge-result" class="challenge-feedback is-hidden">
            <span id="challenge-verdict"></span>
            <button id="act-next-round" class="action-btn accent sm"></button>
          </div>
        </div>

        <div id="genealogy-card" class="is-hidden" role="dialog" aria-label="古今地名沿革">
          <div class="genealogy-header">
            <div class="genealogy-heading-group">
              <div class="genealogy-tag" id="txt-genealogy-kicker">点地溯源 · 古今政区沿革</div>
              <div id="genealogy-heading" class="genealogy-title"></div>
            </div>
            <div class="genealogy-header-actions">
              <button id="act-expand-genealogy" class="icon-close gen-expand-btn" type="button" title="展开/收起沿革面板" aria-expanded="false" aria-label="展开或收起沿革面板">⤢</button>
              <button id="act-close-genealogy" class="icon-close" type="button" title="关闭" aria-label="关闭">
                <svg class="ico-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
            </div>
          </div>
          <div id="genealogy-sub" class="genealogy-sub"></div>
          <div id="genealogy-body" class="genealogy-body">
            <div id="genealogy-lore" class="pass-lore-banner is-hidden"></div>
            <ol id="genealogy-timeline" class="genealogy-list"></ol>
          </div>
        </div>

        <div id="journey-card" class="is-hidden" role="region" aria-label="多站路线控制栏"></div>

        <div id="milestone-balloon" class="is-hidden" role="dialog" aria-live="polite"></div>

        <div id="hover-tip" class="is-hidden" role="tooltip"></div>

        <div id="gesture-guide">滚轮缩放 · 拖拽平移 · 点击城名或双击任意处查沿革 · ← → 逐事件跳转（Shift+← → ±10年） · 空格播放</div>
      </div>
</template>
