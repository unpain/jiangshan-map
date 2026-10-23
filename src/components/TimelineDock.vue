<script setup lang="ts">
import { useAtlas } from '../composables/useAtlas';
const atlas = useAtlas();
function onYearChange(event: Event) {
  atlas.setYear(Number((event.target as HTMLInputElement).value));
}
</script>

<template>
<footer id="scrubber-dock" aria-label="历史年份时间轴">
      <div class="playback-controls-group">
        <button id="act-autoplay" @click="atlas.togglePlayback()" class="round-btn" type="button" title="自动播放 / 暂停（空格）" aria-label="播放" aria-pressed="false">
          <svg class="ico-svg" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><polygon points="4.5,2.8 13.2,8 4.5,13.2" fill="currentColor"/></svg>
        </button>
        <button id="act-play-speed" @click="atlas.cyclePlaySpeed()" class="play-speed-btn" type="button" title="播放倍速 1×（点击切换 0.25× / 0.5× / 1× / 2×）" aria-label="播放倍速 1×">
          <span id="lbl-play-speed">1×</span>
        </button>
      </div>

      <div id="scrubber-rail-wrap">
        <div id="scrubber-Bubble" aria-live="polite">
          <span id="bubble-text">公元前403年 · 周威烈王二十三年</span>
        </div>
        <div id="scrubber-track" role="slider" tabindex="0" aria-valuemin="-403" aria-valuemax="2026" aria-valuenow="-403" aria-label="年份滑块">
          <div id="dynasty-bands"></div>
          <div id="scrubber-handle"></div>
        </div>
        <div id="scrubber-ticks"></div>
      </div>

      <div class="year-stepper">
        <button id="act-step-prev" @click="atlas.stepTimeline(-1)" class="step-nav-btn" type="button" title="上一历史阶段 / 事件节点（←）· Shift+← 退十年" aria-label="上一历史节点">‹</button>
        <input id="inp-year" @change="onYearChange" type="number" min="-403" max="2026" step="1" value="-403" aria-label="输入年份（负数为公元前）" />
        <span class="unit-label" id="txt-year-suffix">年</span>
        <button id="act-step-next" @click="atlas.stepTimeline(1)" class="step-nav-btn" type="button" title="下一历史阶段 / 事件节点（→）· Shift+→ 进十年" aria-label="下一历史节点">›</button>
      </div>
    </footer>
</template>
