<script setup lang="ts">
import { computed } from 'vue'
import { account, closeAccount, requestLoginCode, submitNickname, verifyLoginCode } from '../lib/account'
import Ico from './Ico.vue'

const TITLES = { email: '邮箱登录', code: '输入邮箱验证码', name: '给自己起个昵称' }
const title = computed(() => TITLES[account.step])
function submit() {
  if (account.step === 'email') void requestLoginCode()
  else if (account.step === 'code') void verifyLoginCode()
  else void submitNickname()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="account.open" class="account-overlay" @click.self="closeAccount">
      <section class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
        <button class="account-close" type="button" aria-label="关闭" :disabled="account.busy" @click="closeAccount"><Ico name="close" /></button>
        <span class="account-mark"><Ico :name="account.step === 'name' ? 'edit' : 'users'" /></span>
        <h2 id="account-title">{{ title }}</h2>
        <p v-if="account.step === 'email'">使用邮箱登录，昵称、课表和寝室都跟着账号走，换设备也不丢。</p>
        <p v-else-if="account.step === 'code'">验证码已发送到 <b>{{ account.email }}</b>，10 分钟内有效。</p>
        <p v-else>登录成功！发笔记、评论时会显示这个昵称，之后可以在「我的」里修改。</p>
        <form @submit.prevent="submit">
          <label v-if="account.step === 'email'">邮箱地址<input v-model="account.email" type="email" autocomplete="email" placeholder="name@shanghaitech.edu.cn" required :disabled="account.busy" /></label>
          <label v-else-if="account.step === 'code'">6 位验证码<input v-model="account.code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required :disabled="account.busy" /></label>
          <label v-else>昵称<input v-model="account.name" autocomplete="nickname" minlength="2" maxlength="16" placeholder="2–16 个字，不能和别人重名" required :disabled="account.busy" /></label>
          <p v-if="account.error" class="account-error" role="alert">{{ account.error }}</p>
          <p v-if="account.message" class="account-message" role="status">{{ account.message }}</p>
          <button class="account-submit" :disabled="account.busy">{{ account.busy ? '处理中…' : account.step === 'email' ? '发送验证码' : account.step === 'code' ? '登录' : '完成' }}</button>
          <button v-if="account.step === 'code'" type="button" class="account-back" :disabled="account.busy" @click="account.step = 'email'; account.error = ''">换一个邮箱</button>
          <button v-if="account.step === 'name'" type="button" class="account-back" :disabled="account.busy" @click="closeAccount">稍后再说（起好昵称前不能发笔记和评论）</button>
        </form>
        <small v-if="account.step !== 'name'">默认填入上科大邮箱，也可以改成其他邮箱。</small>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.account-overlay { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 20px; background: #10201866; }
.account-dialog { position: relative; width: min(390px, 100%); padding: 30px 26px 24px; border-radius: 20px; background: #fff; box-shadow: 0 18px 60px #10201840; }
.account-close { position: absolute; top: 12px; right: 12px; border: 0; background: none; color: #78827b; cursor: pointer; font-size: 18px; }
.account-mark { display: grid; place-items: center; width: 42px; height: 42px; margin-bottom: 12px; border-radius: 13px; background: #eaf4ee; color: #247345; font-size: 22px; }
.account-dialog h2 { margin: 0; font-size: 21px; color: #26372c; }.account-dialog p { color: #66736b; font-size: 13px; line-height: 1.6; }.account-dialog form { display: grid; gap: 12px; margin-top: 18px; }.account-dialog label { display: grid; gap: 6px; color: #536158; font-size: 12px; font-weight: 600; }.account-dialog input { width: 100%; box-sizing: border-box; padding: 11px 12px; border: 1px solid #d8dfda; border-radius: 10px; font: inherit; }.account-submit { padding: 11px; border: 0; border-radius: 10px; background: #237548; color: white; font-weight: 700; cursor: pointer; }.account-submit:disabled { opacity: .6; }.account-back { border: 0; background: none; color: #31714e; cursor: pointer; }.account-error { margin: 0; color: #b43c3c !important; }.account-message { margin: 0; color: #257448 !important; }.account-dialog small { display: block; margin-top: 14px; color: #8a958d; font-size: 11px; }
</style>
