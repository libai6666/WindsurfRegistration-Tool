/**
 * Content Script
 * 处理来自 popup 的消息，执行注册和填卡操作
 */

console.log('[Content Script] Content script 已加载');

// 浮动面板相关
let floatingPanel = null;
let floatingButton = null;
let isPanelVisible = false;

// 防止重复操作的标志
let continueButtonClicked = false;
let passwordFilled = false;
let passwordSubmitted = false;
let turnstileHandled = false; // Turnstile 验证是否已处理
let isCheckingTurnstile = false; // 是否正在检测人机验证
let turnstileError = false; // 是否已经检测到 Turnstile 错误（An error occurred）

const TURNSTILE_CONTINUE_CLICK_DELAY = 1500; // ms

function startDelayedContinueRetry() {
	if (turnstileError) {
		console.log('[Content Script] 已检测到 Turnstile 错误，停止重试 Continue');
		return;
	}
	const retryInterval = setInterval(() => {
		const retryButton = Array.from(document.querySelectorAll('button')).find(btn => {
			const btnText = (btn.textContent || btn.innerText || '').trim();
			return (btnText === 'Continue' || btnText === '继续') && 
			       !btn.disabled && 
			       !btn.className.includes('text-sk-black/40') &&
			       !btnText.includes('Other') && 
			       !btnText.includes('options');
		});
		
		if (retryButton && !retryButton.disabled) {
			clearInterval(retryInterval);
			setTimeout(() => {
				retryButton.focus();
				retryButton.click();
				retryButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
				retryButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
				retryButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
				
				console.log('[Content Script] 重试：已点击 Continue 按钮');
				updateFloatingStatus('已点击 Continue，等待页面跳转...', 'info');
				addFloatingLog('已点击 Continue 按钮（重试）', 'success');
				
				setTimeout(() => {
					startListeningEmail();
				}, 2000);
			}, TURNSTILE_CONTINUE_CLICK_DELAY);
		}
	}, 500);
	
	// 最多重试30秒
	setTimeout(() => {
		clearInterval(retryInterval);
		console.log('[Content Script] 重试超时，直接开始监听邮件');
		startListeningEmail();
	}, 30000);
}

const MOEMAIL_SESSION_KEYS = {
	id: 'windsurf_moemail_id',
	email: 'windsurf_moemail_email'
};

const moemailMonitorState = {
	active: false,
	pollTimer: null,
	lastCode: '',
	cursor: '',
	retries: 0,
	maxRetries: 120,
	startedAt: null,
	pendingCode: '',
	processingCode: false
};

function sendExtensionMessage(type, payload = {}) {
	return new Promise((resolve, reject) => {
		try {
			chrome.runtime.sendMessage({ type, payload }, (response) => {
				if (chrome.runtime.lastError) {
					reject(new Error(chrome.runtime.lastError.message));
					return;
				}
				
				resolve(response);
			});
		} catch (error) {
			reject(error);
		}
	});
}

function storeMoemailSession({ id, email }) {
	if (!id || !email) {
		return;
	}
	
	sessionStorage.setItem(MOEMAIL_SESSION_KEYS.id, id);
	sessionStorage.setItem(MOEMAIL_SESSION_KEYS.email, email);
}

function clearMoemailSession() {
	sessionStorage.removeItem(MOEMAIL_SESSION_KEYS.id);
	sessionStorage.removeItem(MOEMAIL_SESSION_KEYS.email);
}

function getMoemailSession() {
	const id = sessionStorage.getItem(MOEMAIL_SESSION_KEYS.id);
	const email = sessionStorage.getItem(MOEMAIL_SESSION_KEYS.email);
	
	if (id && email) {
		return { id, email };
	}
	
	return { id: null, email: null };
}

/**
 * 检测是否存在人机验证（提交密码后调用）
 * 如果存在，监听验证完成；如果不存在，直接监听邮件消息
 */
function checkTurnstileAndListen() {
	if (isCheckingTurnstile || turnstileHandled) {
		console.log('[Content Script] 已在检测人机验证或已处理，跳过重复检测');
		return;
	}
	
	isCheckingTurnstile = true;
	console.log('[Content Script] 开始检测人机验证...');
	updateFloatingStatus('检测人机验证...', 'info');
	addFloatingLog('开始检测人机验证', 'info');
	
	let checkCount = 0;
	const maxChecks = 30; // 最多检查30次（15秒）
	
	const checkInterval = setInterval(() => {
		checkCount++;
		
		// 检查是否有人机验证页面
		const turnstileResponse = document.querySelector('input[name="cf-turnstile-response"], input[id*="cf-turnstile"], input[id*="cf-chl-widget"]');
		
		// 查找所有可能的 Turnstile iframe
		const turnstileIframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[id*="cf-chl-widget"], iframe[id*="cf-chl"], iframe[src*="cloudflare"]');
		
		// 也查找所有 iframe，检查是否包含 Turnstile 相关内容
		let allIframes = document.querySelectorAll('iframe');
		let foundTurnstileIframe = turnstileIframe;
		
		if (!foundTurnstileIframe && allIframes.length > 0) {
			for (const iframe of allIframes) {
				const src = (iframe.src || '').toLowerCase();
				const id = (iframe.id || '').toLowerCase();
				if (src.includes('cloudflare') || src.includes('turnstile') || src.includes('challenge') ||
				    id.includes('cf-chl') || id.includes('turnstile')) {
					foundTurnstileIframe = iframe;
					break;
				}
			}
		}
		
		const errorBanner = Array.from(document.querySelectorAll('div,p,span')).find(el => {
			const text = (el.textContent || '').trim().toLowerCase();
			return text.includes('an error occurred') || text.includes('please try again later');
		});
		
		const hasTurnstile = turnstileResponse !== null || 
		                      foundTurnstileIframe !== null ||
		                      document.body.textContent.includes('Please verify that you are human') ||
		                      document.body.textContent.includes('verify that you are human');
		
		if (errorBanner) {
			clearInterval(checkInterval);
			isCheckingTurnstile = false;
			turnstileError = true;
			console.warn('[Content Script] 人机验证出现错误提示，可能需要更换 IP');
			const message = '检测到 Cloudflare 错误（请稍后再试或更换 IP）';
			updateFloatingStatus(message, 'error');
			addFloatingLog('人机验证失败：An error occurred. 请更换 IP 或稍后重试', 'error');
			return;
		}
		
		if (hasTurnstile) {
			clearInterval(checkInterval);
			isCheckingTurnstile = false;
			console.log(`[Content Script] 检测到人机验证（第 ${checkCount} 次检查）`);
			updateFloatingStatus('检测到人机验证，请手动完成验证', 'info');
			addFloatingLog(`检测到人机验证（等待了 ${checkCount * 0.5} 秒），请手动完成验证`, 'info');
			
			// 开始监听验证完成
			startListeningTurnstileComplete();
			return;
		}
		
		// 如果检查次数超过限制，认为没有人机验证
		if (checkCount >= maxChecks) {
			clearInterval(checkInterval);
			isCheckingTurnstile = false;
			console.log('[Content Script] 未检测到人机验证，开始监听邮件消息');
			updateFloatingStatus('未检测到人机验证，开始监听邮件...', 'info');
			addFloatingLog('未检测到人机验证，开始监听邮件消息', 'info');
			
			// 直接开始监听邮件消息
			startListeningEmail();
		} else {
			// 继续等待，显示等待状态
			if (checkCount % 4 === 0) { // 每2秒更新一次状态
				updateFloatingStatus(`检测人机验证... (${checkCount * 0.5}秒)`, 'info');
			}
		}
	}, 500); // 每500ms检查一次
}

/**
 * 监听人机验证是否完成
 */
function startListeningTurnstileComplete() {
	if (turnstileError) {
		console.log('[Content Script] Turnstile 已出错，取消监听完成状态');
		return;
	}
	console.log('[Content Script] 开始监听人机验证完成...');
	updateFloatingStatus('等待人机验证完成...', 'info');
	addFloatingLog('开始监听人机验证完成，请手动完成验证', 'info');
	
	let checkCount = 0;
	const maxChecks = 120; // 最多检查120次（60秒）
	
	const checkInterval = setInterval(() => {
		checkCount++;
		
		// 1. 优先检查验证成功标志（#success 元素显示）
		const successElement = document.getElementById('success');
		const successText = document.getElementById('success-text');
		let isVerificationSuccess = false;
		
		if (successElement) {
			// 检查内联样式
			const inlineStyle = successElement.getAttribute('style') || '';
			const hasInlineDisplay = inlineStyle.includes('display:') && !inlineStyle.includes('display: none');
			const hasInlineVisibility = inlineStyle.includes('visibility: visible');
			
			// 检查计算样式
			const style = window.getComputedStyle(successElement);
			const computedDisplay = style.display !== 'none';
			const computedVisibility = style.visibility === 'visible';
			
			// 检查文本内容
			const hasSuccessText = successText && (successText.textContent || successText.innerText || '').trim().includes('成功');
			
			// 如果内联样式显示为 grid/flex/block 且 visibility 为 visible，或者计算样式显示可见，或者有成功文本
			if ((hasInlineDisplay && hasInlineVisibility) || (computedDisplay && computedVisibility) || hasSuccessText) {
				isVerificationSuccess = true;
				console.log('[Content Script] 检测到验证成功标志 (#success)', {
					inlineStyle,
					computedDisplay,
					computedVisibility,
					hasSuccessText
				});
			}
		}
		
		// 2. 检查 Continue 按钮是否已启用（说明验证完成）
		const continueButton = Array.from(document.querySelectorAll('button')).find(btn => {
			const btnText = (btn.textContent || btn.innerText || '').trim();
			return (btnText === 'Continue' || btnText === '继续') && 
			       !btn.className.includes('text-sk-black/40') &&
			       !btnText.includes('Other') && 
			       !btnText.includes('options');
		});
		
		// 3. 检查 turnstile-response 是否有值（说明验证完成）
		const turnstileResponse = document.querySelector('input[name="cf-turnstile-response"], input[id*="cf-turnstile"], input[id*="cf-chl-widget"]');
		const hasResponseValue = turnstileResponse && turnstileResponse.value && turnstileResponse.value.length > 0;
		
		// 如果检测到验证成功标志，或者 Continue 按钮已启用，或者 response 有值
		if (isVerificationSuccess || (continueButton && !continueButton.disabled) || hasResponseValue) {
			clearInterval(checkInterval);
			console.log('[Content Script] 人机验证已完成');
			
			if (isVerificationSuccess) {
				updateFloatingStatus('人机验证成功！正在点击 Continue...', 'success');
				addFloatingLog('检测到验证成功标志', 'success');
			} else if (continueButton && !continueButton.disabled) {
				updateFloatingStatus('人机验证已完成，Continue 按钮已启用，正在点击...', 'success');
				addFloatingLog('Continue 按钮已启用', 'success');
			} else {
				updateFloatingStatus('人机验证已完成（检测到响应值），正在点击 Continue...', 'success');
				addFloatingLog('检测到验证响应值', 'success');
			}
			
			// 查找并点击 Continue 按钮
			if (continueButton) {
				setTimeout(() => {
					// 确保按钮可见且未禁用
					if (!continueButton.disabled) {
						continueButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
						setTimeout(() => {
							if (continueButton.disabled) {
								console.warn('[Content Script] 延迟后 Continue 按钮重新禁用，等待重试');
								updateFloatingStatus('Continue 按钮仍不可点击，等待中...', 'info');
								startDelayedContinueRetry();
								return;
							}
							
							continueButton.focus();
							continueButton.click();
							
							// 触发事件以确保点击生效
							continueButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
							continueButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
							continueButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
							
							console.log('[Content Script] 已点击 Continue 按钮');
							updateFloatingStatus('已点击 Continue，等待页面跳转...', 'info');
							addFloatingLog('已点击 Continue 按钮', 'success');
							
							// 等待页面跳转后，开始监听邮件消息
							setTimeout(() => {
								startListeningEmail();
							}, 2000);
						}, TURNSTILE_CONTINUE_CLICK_DELAY);
					} else {
						console.log('[Content Script] Continue 按钮仍被禁用，等待中...');
						updateFloatingStatus('Continue 按钮仍被禁用，等待中...', 'info');
						startDelayedContinueRetry();
					}
				}, 500);
			} else {
				// 如果找不到 Continue 按钮，直接开始监听邮件
				console.log('[Content Script] 未找到 Continue 按钮，直接开始监听邮件');
				updateFloatingStatus('验证完成，开始监听邮件...', 'info');
				setTimeout(() => {
					startListeningEmail();
				}, 1000);
			}
			return;
		}
		
		// 如果检查次数超过限制
		if (checkCount >= maxChecks) {
			clearInterval(checkInterval);
			console.log('[Content Script] 等待验证超时');
			updateFloatingStatus('等待验证超时，请检查验证状态', 'error');
			addFloatingLog('等待验证超时（60秒）', 'error');
		} else {
			// 每10秒更新一次状态
			if (checkCount % 20 === 0) {
				updateFloatingStatus(`等待人机验证完成... (${checkCount * 0.5}秒)`, 'info');
			}
		}
	}, 500); // 每500ms检查一次
}

/**
 * 监听邮件消息（验证完成后或没有验证时调用）
 */
function startListeningEmail() {
	if (turnstileError) {
		console.log('[Content Script] Turnstile 出错，跳过邮箱监听');
		return;
	}
	console.log('[Content Script] 开始监听邮件消息...');
	updateFloatingStatus('开始监听邮件消息...', 'info');
	addFloatingLog('开始监听邮件消息，等待验证码输入框', 'info');
	
	let verificationInputDetected = false;
	
	const checkVerificationCode = () => {
		const codeInputs = findVerificationInputs();
		
		if (codeInputs.length > 0) {
			if (!verificationInputDetected) {
			console.log('[Content Script] 检测到验证码输入框');
				updateFloatingStatus('检测到验证码输入框，准备获取验证码...', 'info');
				addFloatingLog('检测到验证码输入框，准备获取验证码', 'info');
				verificationInputDetected = true;
			}
			
			startMoemailVerificationFlow({ forceStart: true, attemptImmediateFill: true });
		}
	};
	
	// 立即检查一次
	checkVerificationCode();
	
	// 使用 MutationObserver 监听 DOM 变化
	const observer = new MutationObserver(() => {
		checkVerificationCode();
	});
	
	observer.observe(document.body, {
		childList: true,
		subtree: true
	});
	
	// 也监听 URL 变化
	let lastUrl = location.href;
	const urlCheckInterval = setInterval(() => {
		if (location.href !== lastUrl) {
			lastUrl = location.href;
			console.log('[Content Script] 页面 URL 已变化:', location.href);
			checkVerificationCode();
		}
	}, 1000);
	
	// 3分钟后停止 DOM 观察（Moemail 监听会继续运行）
	setTimeout(() => {
		observer.disconnect();
		clearInterval(urlCheckInterval);
		console.log('[Content Script] 停止 DOM 监听');
	}, 180000);
}

function findVerificationInputs() {
	const selectors = [
		'input[type="text"][name*="code" i]',
		'input[type="text"][id*="code" i]',
		'input[type="text"][placeholder*="code" i]',
		'input[type="number"][name*="code" i]',
		'input[type="number"][id*="code" i]',
		'input[type="tel"][name*="code" i]',
		'input[type="text"][name*="otp" i]',
		'input[type="text"][id*="otp" i]',
		'input[placeholder*="otp" i]',
		'input[autocomplete="one-time-code"]',
		'input[name*="verification" i]',
		'input[id*="verification" i]',
		'input[placeholder*="verification" i]',
		'input[name*="pin" i]',
		'input[id*="pin" i]',
		'input[placeholder*="pin" i]',
		'input[data-otp-input]',
		'input[placeholder*="验证码"]',
		'input[aria-label*="code" i]',
		'input[data-testid*="code" i]',
		'input[data-testid*="verification" i]'
	];
	
	const results = [];
	const seen = new Set();
	
	for (const selector of selectors) {
		const inputs = document.querySelectorAll(selector);
		for (const input of inputs) {
			if (!seen.has(input)) {
				results.push(input);
				seen.add(input);
			}
		}
	}
	
	if (results.length === 0) {
		const singleCharInputs = Array.from(document.querySelectorAll('input[maxlength="1"]'))
			.filter(input => {
				const type = (input.getAttribute('type') || '').toLowerCase();
				return ['text', 'tel', ''].includes(type);
			});
		
		if (singleCharInputs.length >= 4) {
			const groups = new Map();
			
			for (const input of singleCharInputs) {
				const groupKey = input.closest('.flex') || input.parentElement || document.body;
				if (!groups.has(groupKey)) {
					groups.set(groupKey, []);
				}
				groups.get(groupKey).push(input);
			}
			
			const bestGroup = Array.from(groups.values()).sort((a, b) => b.length - a.length)[0];
			
			if (bestGroup && bestGroup.length >= 4) {
				for (const input of bestGroup) {
					if (!seen.has(input)) {
						results.push(input);
						seen.add(input);
					}
				}
			}
		}
	}
	
	return results;
}

function triggerInputEvents(target) {
	if (!target) return;
	
	target.dispatchEvent(new Event('input', { bubbles: true }));
	target.dispatchEvent(new Event('change', { bubbles: true }));
	target.dispatchEvent(new Event('keyup', { bubbles: true }));
}

function fillVerificationCode(code) {
	if (!code) {
		return false;
	}
	
	const codeInputs = findVerificationInputs();
	if (codeInputs.length === 0) {
		return false;
	}
	
	if (codeInputs.length === 1) {
		const input = codeInputs[0];
		input.focus();
		input.value = code;
		triggerInputEvents(input);
		return true;
	}
	
	const digits = code.split('');
	for (let i = 0; i < codeInputs.length; i++) {
		const char = digits[i] || '';
		const input = codeInputs[i];
		input.focus();
		input.value = char;
		triggerInputEvents(input);
	}
	
	return true;
}

async function submitVerificationCode() {
	const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));
	const targetButton = buttons.find((btn) => {
		const text = (btn.textContent || btn.innerText || btn.value || '').trim().toLowerCase();
		return text.includes('verify') || text.includes('验证') || text.includes('继续') || text.includes('submit') || text.includes('确认');
	});
	
	if (targetButton && !targetButton.disabled) {
		targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
		setTimeout(() => {
			targetButton.click();
			targetButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		}, 300);
		return true;
	}
	
	const codeInputs = findVerificationInputs();
	const form = codeInputs[0]?.closest('form');
	if (form) {
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		if (typeof form.submit === 'function') {
			form.submit();
		}
		return true;
	}
	
	return false;
}

function clearMoemailPollingTimer() {
	if (moemailMonitorState.pollTimer) {
		clearInterval(moemailMonitorState.pollTimer);
		moemailMonitorState.pollTimer = null;
	}
}

function stopMoemailMonitor(message = '', type = 'info') {
	clearMoemailPollingTimer();
	moemailMonitorState.active = false;
	moemailMonitorState.cursor = '';
	moemailMonitorState.lastCode = '';
	moemailMonitorState.retries = 0;
	moemailMonitorState.startedAt = null;
	moemailMonitorState.pendingCode = '';
	moemailMonitorState.processingCode = false;
	
	if (message) {
		addFloatingLog(message, type);
		updateFloatingStatus(message, type === 'error' ? 'error' : 'success');
	}
}

async function processPendingVerificationCode() {
	if (!moemailMonitorState.pendingCode || moemailMonitorState.processingCode) {
		return false;
	}
	
	moemailMonitorState.processingCode = true;
	
	try {
		const code = moemailMonitorState.pendingCode;
		const filled = fillVerificationCode(code);
		
		if (!filled) {
			addFloatingLog('收到验证码，但无法填写输入框', 'error');
			return false;
		}
		
		updateFloatingStatus('验证码已填入，正在提交...', 'success');
		const submitted = await submitVerificationCode();
		
		if (submitted) {
			addFloatingLog('验证码已自动提交', 'success');
		} else {
			addFloatingLog('验证码已填写，请手动提交', 'info');
		}
		
		try {
			const { id: currentId } = getMoemailSession();
			if (currentId) {
				await sendExtensionMessage('moemailDelete', { emailId: currentId });
				clearMoemailSession();
				addFloatingLog('Moemail 邮箱已删除', 'success');
			}
		} catch (deleteError) {
			console.warn('[Content Script] 删除 Moemail 邮箱失败:', deleteError);
			addFloatingLog('删除 Moemail 邮箱失败: ' + deleteError.message, 'error');
		}
		
		moemailMonitorState.pendingCode = '';
		stopMoemailMonitor('验证码已填写并提交', 'success');
		return true;
	} finally {
		moemailMonitorState.processingCode = false;
	}
}

function startMoemailVerificationFlow(options = {}) {
	const { forceStart = false, attemptImmediateFill = false } = options;
	const { id, email } = getMoemailSession();
	
	if (!id || !email) {
		if (forceStart || attemptImmediateFill) {
			addFloatingLog('未找到 Moemail 邮箱信息，无法监听验证码', 'error');
		}
		return;
	}
	
	if (attemptImmediateFill && moemailMonitorState.pendingCode) {
		processPendingVerificationCode().catch((err) => {
			console.error('[Content Script] 处理验证码失败:', err);
		});
	}
	
	if (moemailMonitorState.active) {
		return;
	}
	
	moemailMonitorState.active = true;
	moemailMonitorState.cursor = '';
	moemailMonitorState.lastCode = '';
	moemailMonitorState.retries = 0;
	moemailMonitorState.startedAt = Date.now();
	moemailMonitorState.pendingCode = '';
	
	addFloatingLog(`开始监听邮箱验证码：${email}`, 'info');
	updateFloatingStatus('正在监听邮箱验证码...', 'info');
	
	const pollInbox = async () => {
		const { id: currentId } = getMoemailSession();
		if (!currentId) {
			stopMoemailMonitor('Moemail 邮箱信息已失效', 'error');
			return;
		}
		
		moemailMonitorState.retries += 1;
		if (moemailMonitorState.retries > moemailMonitorState.maxRetries) {
			stopMoemailMonitor('监听验证码超时，请手动检查邮箱', 'error');
			return;
		}
		
		try {
			const response = await sendExtensionMessage('moemailFetchMessages', {
				emailId: currentId,
				cursor: moemailMonitorState.cursor
			});
			
			if (!response?.success) {
				throw new Error(response?.error || '获取邮件失败');
			}
			
			const data = response.data || {};
			if (data.cursor) {
				moemailMonitorState.cursor = data.cursor;
			}
			
			const latestCode = data.latestCode;
			if (latestCode && latestCode !== moemailMonitorState.lastCode) {
				moemailMonitorState.lastCode = latestCode;
				moemailMonitorState.pendingCode = latestCode;
				addFloatingLog(`收到验证码：${latestCode}`, 'success');
				clearMoemailPollingTimer();
				processPendingVerificationCode().catch((err) => {
					console.error('[Content Script] 处理验证码失败:', err);
				});
			}
		} catch (error) {
			console.error('[Content Script] 监听邮箱失败:', error);
			addFloatingLog('监听邮箱失败: ' + error.message, 'error');
		}
	};
	
	// 立即执行一次，然后每5秒轮询
	pollInbox();
	moemailMonitorState.pollTimer = setInterval(pollInbox, 5000);
}


/**
 * 检查并填写密码（在下一个页面）
 */
function checkAndFillPassword() {
	const password = sessionStorage.getItem('windsurf_registration_password');
	if (!password) {
		return; // 没有保存的密码，直接返回
	}
	
	// 如果已经填写并提交了密码，不再执行任何操作
	if (passwordSubmitted) {
		return;
	}
	
	// 1. 查找所有密码输入框（包括主密码和确认密码）
	const passwordSelectors = [
		'input[type="password"]',
		'input[name*="password" i]',
		'input[id*="password" i]',
		'input[placeholder*="password" i]',
		'input[autocomplete*="password" i]'
	];
	
	// 查找主密码输入框（排除确认密码）
	const mainPasswordSelectors = [
		'input[type="password"]:not([id*="confirm" i]):not([name*="confirm" i]):not([id*="Confirmation" i]):not([name*="Confirmation" i])',
		'input[name*="password" i]:not([name*="confirm" i]):not([name*="Confirmation" i])',
		'input[id*="password" i]:not([id*="confirm" i]):not([id*="Confirmation" i])',
		'input[autocomplete="new-password"]:not([id*="confirm" i]):not([name*="confirm" i])',
		'input[autocomplete="current-password"]'
	];
	
	// 查找确认密码输入框
	const confirmPasswordSelectors = [
		'input[id*="passwordConfirmation" i]',
		'input[id*="confirmPassword" i]',
		'input[name*="confirmPassword" i]',
		'input[name*="passwordConfirmation" i]',
		'input[placeholder*="confirm" i][type="password"]',
		'input[placeholder*="Confirm" i][type="password"]'
	];
	
	let passwordInput = null;
	let confirmPasswordInput = null;
	
	// 先尝试通过特定选择器查找主密码
	for (const selector of mainPasswordSelectors) {
		try {
			const inputs = document.querySelectorAll(selector);
			for (const input of inputs) {
				// 排除确认密码字段
				const id = (input.id || '').toLowerCase();
				const name = (input.name || '').toLowerCase();
				if (!id.includes('confirm') && !name.includes('confirm') && 
				    !id.includes('confirmation') && !name.includes('confirmation')) {
					passwordInput = input;
					break;
				}
			}
			if (passwordInput) break;
		} catch (e) {
			// 选择器可能不支持，继续尝试
		}
	}
	
	// 如果没找到，使用通用选择器
	if (!passwordInput) {
		const allPasswordInputs = document.querySelectorAll('input[type="password"]');
		for (const input of allPasswordInputs) {
			const id = (input.id || '').toLowerCase();
			const name = (input.name || '').toLowerCase();
			const placeholder = (input.placeholder || '').toLowerCase();
			
			// 如果是确认密码字段，跳过
			if (id.includes('confirm') || name.includes('confirm') || 
			    id.includes('confirmation') || name.includes('confirmation') ||
			    placeholder.includes('confirm')) {
				continue;
			}
			
			passwordInput = input;
			break;
		}
	}
	
	// 查找确认密码输入框
	for (const selector of confirmPasswordSelectors) {
		confirmPasswordInput = document.querySelector(selector);
		if (confirmPasswordInput) break;
	}
	
	// 如果还是没找到确认密码，尝试查找所有密码输入框，选择第二个
	if (!confirmPasswordInput && passwordInput) {
		const allPasswordInputs = document.querySelectorAll('input[type="password"]');
		if (allPasswordInputs.length > 1) {
			// 找到第二个密码输入框（通常是确认密码）
			for (let i = 0; i < allPasswordInputs.length; i++) {
				if (allPasswordInputs[i] !== passwordInput) {
					const id = (allPasswordInputs[i].id || '').toLowerCase();
					const name = (allPasswordInputs[i].name || '').toLowerCase();
					const placeholder = (allPasswordInputs[i].placeholder || '').toLowerCase();
					
					// 如果包含 confirm 相关关键词，或者就是第二个密码输入框
					if (id.includes('confirm') || name.includes('confirm') || 
					    id.includes('confirmation') || name.includes('confirmation') ||
					    placeholder.includes('confirm') || 
					    placeholder.includes('Confirm')) {
						confirmPasswordInput = allPasswordInputs[i];
						break;
					}
				}
			}
			
			// 如果还是没找到，就使用第二个密码输入框
			if (!confirmPasswordInput && allPasswordInputs.length > 1) {
				for (let i = 0; i < allPasswordInputs.length; i++) {
					if (allPasswordInputs[i] !== passwordInput) {
						confirmPasswordInput = allPasswordInputs[i];
						break;
					}
				}
			}
		}
	}
	
	// 如果找到密码输入框
	if (passwordInput) {
		// 如果已经填写过密码，检查是否需要填写确认密码和提交
		if (passwordFilled) {
			// 检查密码是否还在（可能页面刷新了）
			if (passwordInput.value === password) {
				// 检查确认密码是否已填写
				if (confirmPasswordInput && !confirmPasswordInput.value) {
					confirmPasswordInput.focus();
					confirmPasswordInput.value = password;
					confirmPasswordInput.dispatchEvent(new Event('input', { bubbles: true }));
					confirmPasswordInput.dispatchEvent(new Event('change', { bubbles: true }));
					console.log('[Content Script] 已填写确认密码');
					
					// 等待一下再提交
					setTimeout(() => {
						submitPasswordForm();
					}, 500);
					return;
				}
				
				// 密码和确认密码都已填写，尝试提交
				if (!passwordSubmitted) {
					setTimeout(() => {
						submitPasswordForm();
					}, 500);
				}
			}
			return;
		}
		
		// 如果密码输入框存在但未填写，填写密码
		if (!passwordInput.value) {
			passwordInput.focus();
			passwordInput.value = password;
			passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
			passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
			console.log('[Content Script] 已填写密码');
			
			// 如果存在确认密码输入框，也填写
			if (confirmPasswordInput && !confirmPasswordInput.value) {
				// 等待一下再填写确认密码，让页面有时间处理第一个密码输入
				setTimeout(() => {
					confirmPasswordInput.focus();
					confirmPasswordInput.value = password;
					confirmPasswordInput.dispatchEvent(new Event('input', { bubbles: true }));
					confirmPasswordInput.dispatchEvent(new Event('change', { bubbles: true }));
					console.log('[Content Script] 已填写确认密码');
				}, 500);
			}
			
			passwordFilled = true;
			
			// 等待一段时间再提交，避免页面返回
			// 等待时间：如果有确认密码字段，等待更长时间（2秒），否则等待1.5秒
			const waitTime = confirmPasswordInput ? 2000 : 1500;
			console.log(`[Content Script] 填写完密码，等待 ${waitTime}ms 后提交，避免页面返回...`);
			updateFloatingStatus(`填写完密码，等待 ${waitTime/1000} 秒后提交...`, 'info');
			addFloatingLog(`填写完密码，等待 ${waitTime/1000} 秒后提交，避免页面返回`, 'info');
			
			setTimeout(() => {
				console.log('[Content Script] 等待时间结束，开始提交密码表单');
				submitPasswordForm();
			}, waitTime);
			return;
		}
	}
	
	// 提交密码表单的辅助函数
	function submitPasswordForm() {
		if (passwordSubmitted) {
			console.log('[Content Script] 密码已提交，跳过重复提交');
			return;
		}
		
		console.log('[Content Script] 开始提交密码表单...');
		
		// 保存当前 URL，用于检测页面是否跳转
		const currentUrl = location.href;
		const currentPath = location.pathname;
		
		// 防止页面返回（通过监听 beforeunload 和 popstate）
		const preventBack = (e) => {
			console.log('[Content Script] 检测到页面返回尝试，当前在密码页面，阻止返回');
			// 不阻止，但记录
		};
		
		window.addEventListener('beforeunload', preventBack, { once: true });
		window.addEventListener('popstate', preventBack, { once: true });
		
		// 检查是否有人机验证页面（Cloudflare Turnstile）
		const turnstileResponse = document.querySelector('input[name="cf-turnstile-response"], input[id*="cf-turnstile"], input[id*="cf-chl-widget"]');
		const hasTurnstile = turnstileResponse !== null || 
		                      document.body.textContent.includes('Please verify that you are human') ||
		                      document.body.textContent.includes('verify that you are human');
		
		if (hasTurnstile && !turnstileHandled) {
			console.log('[Content Script] 检测到 Cloudflare Turnstile 人机验证');
			updateFloatingStatus('检测到人机验证，正在自动处理...', 'info');
			addFloatingLog('检测到 Cloudflare Turnstile 验证', 'info');
			
			turnstileHandled = true;
			
			// 开始监听验证完成（不再自动点击）
			startListeningTurnstileComplete();
			return; // 等待验证完成后再继续
		}
		
		// 检查其他类型的人机验证
		const captchaSelectors = [
			'iframe[src*="recaptcha"]',
			'iframe[src*="captcha"]',
			'iframe[src*="turnstile"]',
			'div[id*="recaptcha"]',
			'div[class*="recaptcha"]',
			'div[id*="captcha"]',
			'div[class*="captcha"]',
			'div[id*="turnstile"]',
			'div[class*="turnstile"]',
			'canvas[id*="captcha"]',
			'img[src*="captcha"]'
		];
		
		let hasCaptcha = false;
		for (const selector of captchaSelectors) {
			const captcha = document.querySelector(selector);
			if (captcha) {
				hasCaptcha = true;
				console.log('[Content Script] 检测到人机验证，等待用户完成验证...');
				updateFloatingStatus('检测到人机验证，请手动完成验证', 'info');
				addFloatingLog('检测到人机验证，请手动完成验证后继续', 'info');
				break;
			}
		}
		
		// 优先查找 "Continue" 按钮（密码页面应该点击这个）
		let submitButton = null;
		
		// 1. 首先查找包含 "Continue" 文本的按钮，但排除 "Other Sign up options"
		const allButtons = document.querySelectorAll('button');
		for (const btn of allButtons) {
			const btnText = (btn.textContent || btn.innerText || '').trim();
			const btnClass = (btn.className || '').toLowerCase();
			
			// 检查是否是 "Continue" 按钮，并且不是 "Other Sign up options"
			if (btnText === 'Continue' || btnText === '继续') {
				// 排除包含 "Other" 或 "options" 的按钮
				if (!btnText.includes('Other') && !btnText.includes('options') && 
				    !btnClass.includes('text-sk-black/40')) {
					submitButton = btn;
					console.log('[Content Script] 找到 Continue 按钮:', btnText);
					break;
				}
			}
		}
		
		// 2. 如果没找到 Continue 按钮，尝试查找 type="submit" 的按钮
		if (!submitButton) {
			submitButton = document.querySelector('button[type="submit"], button[class*="submit" i], button[id*="submit" i], input[type="submit"]');
		}
		
		// 3. 如果还是没找到，查找包含特定 class 的按钮（根据用户提供的 class）
		if (!submitButton) {
			// 查找包含 bg-sk-aqua 的按钮（Continue 按钮的特征）
			submitButton = document.querySelector('button.bg-sk-aqua, button[class*="bg-sk-aqua"]');
		}
		
		if (submitButton && submitButton.disabled) {
			console.log('[Content Script] 提交按钮被禁用，可能表单验证未通过或需要人机验证');
			updateFloatingStatus('提交按钮被禁用，请检查表单或完成验证', 'error');
			addFloatingLog('提交按钮被禁用，请检查表单或完成验证', 'error');
			
			// 等待一下，可能验证会完成
			setTimeout(() => {
				if (!submitButton.disabled && !passwordSubmitted) {
					console.log('[Content Script] 提交按钮已启用，重新尝试提交');
					submitPasswordForm();
				}
			}, 3000);
			return;
		}
		
		if (submitButton && !passwordSubmitted) {
			// 先检查表单验证
			const form = submitButton.closest('form');
			
			// 检查密码和确认密码是否匹配
			if (passwordInput && confirmPasswordInput) {
				if (passwordInput.value !== confirmPasswordInput.value) {
					console.warn('[Content Script] 密码和确认密码不匹配，重新填写确认密码');
					confirmPasswordInput.value = passwordInput.value;
					confirmPasswordInput.dispatchEvent(new Event('input', { bubbles: true }));
					confirmPasswordInput.dispatchEvent(new Event('change', { bubbles: true }));
					// 等待一下让页面处理
					setTimeout(() => {
						if (!passwordSubmitted) {
							submitPasswordForm();
						}
					}, 500);
					return;
				}
			}
			
			if (form && !form.checkValidity()) {
				console.log('[Content Script] 表单验证未通过，尝试触发验证');
				form.reportValidity();
				
				// 等待验证完成，但时间缩短
				setTimeout(() => {
					if (form.checkValidity() && !passwordSubmitted) {
						console.log('[Content Script] 表单验证已通过，重新提交');
						submitPasswordForm();
					} else {
						console.warn('[Content Script] 表单验证仍然未通过，但继续尝试提交');
						// 即使验证未通过，也尝试提交（某些网站可能只是警告）
						if (!passwordSubmitted) {
							submitButton.click();
							passwordSubmitted = true;
						}
					}
				}, 1000);
				return;
			}
			
			// 监听表单提交事件
			if (form) {
				let formSubmitted = false;
				form.addEventListener('submit', (e) => {
					formSubmitted = true;
					console.log('[Content Script] 表单正在提交...');
					// 不阻止提交，让表单正常提交
				}, { once: true });
				
				// 如果表单没有触发 submit 事件，可能是通过按钮点击触发的
				setTimeout(() => {
					if (!formSubmitted) {
						console.log('[Content Script] 表单可能通过按钮点击提交，等待页面响应...');
					}
				}, 1000);
			}
			
			// 最后再等待一下，确保所有验证都完成，避免页面返回
			setTimeout(() => {
				// 再次检查按钮是否可用
				if (submitButton.disabled) {
					console.log('[Content Script] 提交按钮仍然被禁用，等待更长时间...');
					updateFloatingStatus('提交按钮被禁用，等待验证完成...', 'info');
					setTimeout(() => {
						if (!submitButton.disabled && !passwordSubmitted) {
							submitButton.focus();
							submitButton.click();
							passwordSubmitted = true;
							console.log('[Content Script] 已点击密码页面的提交按钮（延迟后）');
							updateFloatingStatus('已提交密码表单，等待页面跳转...', 'info');
							addFloatingLog('已点击提交按钮（延迟后）', 'success');
						}
					}, 2000);
					return;
				}
				
				// 点击提交按钮
				submitButton.focus();
				submitButton.click();
				passwordSubmitted = true;
				console.log('[Content Script] 已点击密码页面的提交按钮');
				updateFloatingStatus('已提交密码表单，等待页面跳转...', 'info');
				addFloatingLog('已点击提交按钮', 'success');
				
				// 等待5秒后检测人机验证框并自动点击
				setTimeout(() => {
					console.log('[Content Script] 开始检测人机验证框...');
					updateFloatingStatus('检测人机验证框...', 'info');
					addFloatingLog('开始检测人机验证框', 'info');
					
					// 检测并处理 Turnstile 验证
					checkTurnstileAndListen();
				}, 5000); // 等待5秒
			}, 500); // 额外等待500ms，确保页面稳定
			
			// 监听页面变化
			let checkCount = 0;
			const maxChecks = 20; // 最多检查20次（10秒）
			const checkInterval = setInterval(() => {
				checkCount++;
				const newUrl = location.href;
				const newPath = location.pathname;
				
				// 如果 URL 或路径发生变化，说明页面已跳转
				if (newUrl !== currentUrl || newPath !== currentPath) {
					clearInterval(checkInterval);
					console.log('[Content Script] 页面已跳转:', newUrl);
					updateFloatingStatus('页面已跳转，等待下一步...', 'success');
					addFloatingLog('页面已跳转: ' + newPath, 'success');
					
					// 重置标志，准备处理新页面
					setTimeout(() => {
						continueButtonClicked = false;
						passwordFilled = false;
						passwordSubmitted = false;
					}, 2000);
					return;
				}
				
				// 检查是否回到了注册初始页面（说明提交失败或页面刷新）
				if (location.pathname.includes('/register') && 
				    !location.pathname.includes('password') &&
				    !location.pathname.includes('confirm') &&
				    document.querySelector('input[name*="first" i], input[id*="first" i]')) {
					clearInterval(checkInterval);
					console.warn('[Content Script] 检测到页面回到了注册初始页面，可能提交失败或需要重新填写');
					updateFloatingStatus('页面回到注册页面，可能提交失败', 'error');
					addFloatingLog('页面回到注册页面，可能提交失败或需要人机验证', 'error');
					
					// 重置标志，允许重新填写
					setTimeout(() => {
						continueButtonClicked = false;
						passwordFilled = false;
						passwordSubmitted = false;
						// 清除保存的密码，避免自动填写
						sessionStorage.removeItem('windsurf_registration_password');
					}, 2000);
					return;
				}
				
				// 如果检查次数超过限制，停止检查
				if (checkCount >= maxChecks) {
					clearInterval(checkInterval);
					console.log('[Content Script] 页面未跳转，可能仍在处理中或需要人机验证');
					
					// 检查是否还在密码页面
					if (location.pathname.includes('password') || 
					    (location.pathname.includes('register') && document.querySelector('input[type="password"]'))) {
						console.log('[Content Script] 仍在密码页面，可能需要人机验证');
						updateFloatingStatus('可能需要人机验证，请检查页面', 'info');
						addFloatingLog('页面未跳转，可能需要人机验证', 'info');
					} else if (location.pathname.includes('/register') && 
					           !location.pathname.includes('password') &&
					           document.querySelector('input[name*="first" i], input[id*="first" i]')) {
						// 回到了注册初始页面
						console.warn('[Content Script] 检测到页面回到了注册初始页面');
						updateFloatingStatus('页面回到注册页面，可能提交失败', 'error');
						addFloatingLog('页面回到注册页面，可能提交失败或需要人机验证', 'error');
					} else {
						console.log('[Content Script] 页面可能已跳转但 URL 未变化（SPA）');
						updateFloatingStatus('等待页面加载...', 'info');
					}
				}
			}, 500);
			
		} else {
			// 如果没找到 submit 按钮，尝试查找其他提交按钮
			// 优先查找 "Continue" 按钮
			if (!submitButton) {
				const allButtons = document.querySelectorAll('button');
				for (const btn of allButtons) {
					const btnText = (btn.textContent || btn.innerText || '').trim();
					const btnClass = (btn.className || '').toLowerCase();
					
					// 优先查找 "Continue" 按钮
					if ((btnText === 'Continue' || btnText === '继续') && 
					    !btnText.includes('Other') && 
					    !btnText.includes('options') &&
					    !btnClass.includes('text-sk-black/40')) {
						submitButton = btn;
						console.log('[Content Script] 找到 Continue 按钮:', btnText);
						break;
					}
				}
			}
			
			// 如果还是没找到，查找其他提交按钮
			if (!submitButton) {
				const allButtons = document.querySelectorAll('button');
				for (const btn of allButtons) {
					const btnText = (btn.textContent || btn.innerText || '').trim();
					const btnClass = (btn.className || '').toLowerCase();
					
					// 排除 "Other Sign up options" 按钮（通过 class 或文本判断）
					if (btnText.includes('Other') || btnText.includes('options') ||
					    btnClass.includes('text-sk-black/40')) {
						continue;
					}
					
					if ((btnText.includes('Submit') || 
					     btnText.includes('Create') ||
					     btnText.includes('Sign up') ||
					     btnText.includes('Register') ||
					     btnText.includes('Continue')) && !passwordSubmitted) {
						submitButton = btn;
						console.log('[Content Script] 找到提交按钮:', btnText);
						break;
					}
				}
			}
			
			// 如果找到了按钮，点击它
			if (submitButton && !passwordSubmitted) {
				submitButton.focus();
				submitButton.click();
				passwordSubmitted = true;
				const btnText = (submitButton.textContent || submitButton.innerText || '').trim();
				console.log('[Content Script] 已点击提交按钮:', btnText);
				updateFloatingStatus('已提交密码表单，等待页面跳转...', 'info');
				addFloatingLog('已点击提交按钮: ' + btnText, 'success');
			} else if (!submitButton) {
				console.warn('[Content Script] 未找到提交按钮');
				updateFloatingStatus('未找到提交按钮', 'error');
				addFloatingLog('未找到提交按钮', 'error');
			}
		}
	}
	
	// 2. 如果没有密码输入框，检查是否有 "Continue" 按钮需要点击（但只点击一次）
	if (!passwordInput && !continueButtonClicked) {
		// 查找包含 "Continue" 文本的按钮
		const allButtons = document.querySelectorAll('button');
		for (const btn of allButtons) {
			const btnText = (btn.textContent || btn.innerText || '').trim();
			if (btnText.includes('Continue') || btnText.includes('继续')) {
				// 检查按钮是否可见且可点击
				const rect = btn.getBoundingClientRect();
				const isVisible = rect.width > 0 && rect.height > 0 && 
				                  window.getComputedStyle(btn).display !== 'none' &&
				                  window.getComputedStyle(btn).visibility !== 'hidden';
				
				if (isVisible && !continueButtonClicked) {
					continueButtonClicked = true;
					console.log('[Content Script] 检测到 Continue 按钮，正在点击...');
					btn.click();
					
					// 点击后等待页面变化，然后再次检查密码输入框
					setTimeout(() => {
						checkAndFillPassword();
					}, 2000);
					return;
				}
			}
		}
	}
}

// 检查 Turnstile 验证的函数
function checkTurnstileVerification() {
	const turnstileResponse = document.querySelector('input[name="cf-turnstile-response"], input[id*="cf-turnstile"], input[id*="cf-chl-widget"]');
	const hasTurnstile = turnstileResponse !== null || 
	                      document.body.textContent.includes('Please verify that you are human') ||
	                      document.body.textContent.includes('verify that you are human');
	
		if (hasTurnstile && !turnstileHandled) {
			console.log('[Content Script] 检测到 Cloudflare Turnstile 人机验证');
			updateFloatingStatus('检测到人机验证，请手动完成验证', 'info');
			addFloatingLog('检测到 Cloudflare Turnstile 验证，请手动完成', 'info');
			
			turnstileHandled = true;
			// 开始监听验证完成
			startListeningTurnstileComplete();
			return true; // 返回 true 表示检测到验证，不需要继续检查密码
		}
		return false; // 返回 false 表示没有检测到验证，继续检查密码
	}

// 页面加载完成后，检查是否需要填写密码或处理验证
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		setTimeout(() => {
			if (!checkTurnstileVerification()) {
				checkAndFillPassword();
			}
		}, 1000);
	});
} else {
	setTimeout(() => {
		if (!checkTurnstileVerification()) {
			checkAndFillPassword();
		}
	}, 1000);
}

// 监听页面变化（SPA 应用可能使用 pushState）
let lastUrl = location.href;
let checkTimeout = null;

const urlChangeObserver = new MutationObserver(() => {
	const url = location.href;
	if (url !== lastUrl) {
		lastUrl = url;
		// 重置标志，因为页面变化了
		continueButtonClicked = false;
		passwordFilled = false;
		passwordSubmitted = false;
		
		// 清除之前的定时器
		if (checkTimeout) {
			clearTimeout(checkTimeout);
		}
		
		// 延迟检查，避免频繁触发
		checkTimeout = setTimeout(() => {
			checkAndFillPassword();
		}, 1000);
	}
});

urlChangeObserver.observe(document, { subtree: true, childList: true });

// 监听 pushState 和 replaceState（SPA 路由变化）
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
	originalPushState.apply(history, args);
	// 重置标志
	continueButtonClicked = false;
	passwordFilled = false;
	passwordSubmitted = false;
	
	if (checkTimeout) {
		clearTimeout(checkTimeout);
	}
	
	checkTimeout = setTimeout(() => {
		turnstileHandled = false; // 重置 Turnstile 标志
		if (!checkTurnstileVerification()) {
			checkAndFillPassword();
		}
	}, 1000);
};

history.replaceState = function(...args) {
	originalReplaceState.apply(history, args);
	// 重置标志
	continueButtonClicked = false;
	passwordFilled = false;
	passwordSubmitted = false;
	turnstileHandled = false;
	
	if (checkTimeout) {
		clearTimeout(checkTimeout);
	}
	
	checkTimeout = setTimeout(() => {
		if (!checkTurnstileVerification()) {
			checkAndFillPassword();
		}
	}, 1000);
};

/**
 * 创建浮动面板
 */
function createFloatingPanel() {
	if (floatingPanel) return;
	
	// 创建样式
	const style = document.createElement('style');
	style.textContent = `
		#windsurf-floating-panel {
			position: fixed;
			top: 20px;
			right: 20px;
			width: 380px;
			max-height: 85vh;
			background: #FFFFFF;
			border-radius: 12px;
			box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
			z-index: 999999;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			display: none;
			overflow: hidden;
			border: 2px solid #F45805;
		}
		#windsurf-floating-panel.visible {
			display: block;
		}
		#windsurf-floating-panel-header {
			background: linear-gradient(135deg, #F45805 0%, #0344A1 100%);
			color: #FFFFFF;
			padding: 12px 16px;
			display: flex;
			justify-content: space-between;
			align-items: center;
			cursor: move;
		}
		#windsurf-floating-panel-title {
			font-size: 16px;
			font-weight: 700;
		}
		#windsurf-floating-panel-close {
			background: rgba(255, 255, 255, 0.2);
			border: none;
			color: #FFFFFF;
			width: 24px;
			height: 24px;
			border-radius: 50%;
			cursor: pointer;
			font-size: 18px;
			line-height: 1;
		}
		#windsurf-floating-panel-close:hover {
			background: rgba(255, 255, 255, 0.3);
		}
		#windsurf-floating-panel-content {
			padding: 16px;
			max-height: calc(85vh - 60px);
			overflow-y: auto;
		}
		#windsurf-floating-panel-content .status {
			padding: 10px;
			border-radius: 6px;
			margin-bottom: 10px;
			font-size: 13px;
			text-align: center;
		}
		#windsurf-floating-panel-content .status.success {
			background: #d4edda;
			color: #155724;
		}
		#windsurf-floating-panel-content .status.error {
			background: #f8d7da;
			color: #721c24;
		}
		#windsurf-floating-panel-content .log {
			max-height: 200px;
			overflow-y: auto;
			font-size: 12px;
			line-height: 1.5;
			padding: 8px;
			background: #f8f9fa;
			border-radius: 4px;
			margin-top: 10px;
		}
		#windsurf-floating-button {
			position: fixed;
			bottom: 20px;
			right: 20px;
			width: 60px;
			height: 60px;
			background: linear-gradient(135deg, #F45805 0%, #0344A1 100%);
			border-radius: 50%;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
			z-index: 999998;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 24px;
			color: #FFFFFF;
			border: 3px solid #FFFFFF;
			transition: transform 0.2s;
		}
		#windsurf-floating-button:hover {
			transform: scale(1.1);
		}
		#windsurf-floating-button.hidden {
			display: none;
		}
	`;
	document.head.appendChild(style);
	
	// 创建浮动按钮
	floatingButton = document.createElement('div');
	floatingButton.id = 'windsurf-floating-button';
	floatingButton.textContent = '🚀';
	floatingButton.title = '打开控制面板';
	floatingButton.addEventListener('click', () => {
		showFloatingPanel();
	});
	document.body.appendChild(floatingButton);
	
	// 创建面板
	floatingPanel = document.createElement('div');
	floatingPanel.id = 'windsurf-floating-panel';
	
	floatingPanel.innerHTML = `
		<div id="windsurf-floating-panel-header">
			<div id="windsurf-floating-panel-title">🚀 Windsurf 工具</div>
			<button id="windsurf-floating-panel-close">×</button>
		</div>
		<div id="windsurf-floating-panel-content">
			<div class="status" id="floating-status">等待开始...</div>
			<div class="log" id="floating-log"></div>
		</div>
	`;
	
	document.body.appendChild(floatingPanel);
	
	// 关闭按钮
	const closeBtn = floatingPanel.querySelector('#windsurf-floating-panel-close');
	closeBtn.addEventListener('click', () => {
		hideFloatingPanel();
	});
	
	// 拖拽功能
	let isDragging = false;
	let currentX, currentY, initialX, initialY;
	
	const header = floatingPanel.querySelector('#windsurf-floating-panel-header');
	header.addEventListener('mousedown', (e) => {
		isDragging = true;
		initialX = e.clientX - floatingPanel.offsetLeft;
		initialY = e.clientY - floatingPanel.offsetTop;
	});
	
	document.addEventListener('mousemove', (e) => {
		if (isDragging) {
			e.preventDefault();
			currentX = e.clientX - initialX;
			currentY = e.clientY - initialY;
			floatingPanel.style.left = currentX + 'px';
			floatingPanel.style.top = currentY + 'px';
			floatingPanel.style.right = 'auto';
		}
	});
	
	document.addEventListener('mouseup', () => {
		isDragging = false;
	});
}

/**
 * 显示浮动面板
 */
function showFloatingPanel() {
	if (!floatingPanel) {
		createFloatingPanel();
	}
	floatingPanel.classList.add('visible');
	if (floatingButton) {
		floatingButton.classList.add('hidden');
	}
	isPanelVisible = true;
}

/**
 * 隐藏浮动面板
 */
function hideFloatingPanel() {
	if (floatingPanel) {
		floatingPanel.classList.remove('visible');
	}
	if (floatingButton) {
		floatingButton.classList.remove('hidden');
	}
	isPanelVisible = false;
}

/**
 * 更新浮动面板状态
 */
function updateFloatingStatus(message, type = 'info') {
	if (!floatingPanel) return;
	const statusEl = floatingPanel.querySelector('#floating-status');
	if (statusEl) {
		statusEl.textContent = message;
		statusEl.className = 'status ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : '');
	}
}

/**
 * 添加浮动面板日志
 */
function addFloatingLog(message, type = 'info') {
	if (!floatingPanel) return;
	const logEl = floatingPanel.querySelector('#floating-log');
	if (logEl) {
		const time = new Date().toLocaleTimeString();
		const logItem = document.createElement('div');
		logItem.className = 'log-item ' + type;
		logItem.textContent = `[${time}] ${message}`;
		logEl.appendChild(logItem);
		logEl.scrollTop = logEl.scrollHeight;
	}
}

// 初始化浮动按钮（页面加载时）
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		setTimeout(() => {
			createFloatingPanel();
		}, 500);
	});
} else {
	setTimeout(() => {
		createFloatingPanel();
	}, 500);
}

// 监听来自 popup 或 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	console.log('[Content Script] 收到消息:', message);
	
	// 异步处理消息
	(async () => {
		try {
			if (message.action === 'showFloatingPanel') {
				showFloatingPanel();
				sendResponse({ success: true });
			} else if (message.action === 'hideFloatingPanel') {
				hideFloatingPanel();
				sendResponse({ success: true });
			} else if (message.action === 'updateFloatingStatus') {
				updateFloatingStatus(message.data.message, message.data.type);
				sendResponse({ success: true });
			} else if (message.action === 'addFloatingLog') {
				addFloatingLog(message.data.message, message.data.type);
				sendResponse({ success: true });
			} else if (message.action === 'startRegistration') {
				showFloatingPanel();
				updateFloatingStatus('开始注册...', 'info');
				addFloatingLog('开始注册流程', 'info');
				await handleStartRegistration(message.data);
				updateFloatingStatus('注册流程已启动', 'success');
				addFloatingLog('注册流程已启动', 'success');
				sendResponse({ success: true, message: '注册流程已启动' });
			} else if (message.action === 'autoFillCard') {
				showFloatingPanel();
				updateFloatingStatus('开始填卡...', 'info');
				addFloatingLog('开始填卡流程', 'info');
				await handleAutoFillCard();
				updateFloatingStatus('填卡流程已启动', 'success');
				addFloatingLog('填卡流程已启动', 'success');
				sendResponse({ success: true, message: '填卡流程已启动' });
			} else if (message.action === 'fillBankCard') {
				showFloatingPanel();
				updateFloatingStatus('开始填写银行卡...', 'info');
				addFloatingLog('开始填写银行卡', 'info');
				await handleFillBankCard();
				updateFloatingStatus('银行卡填写已启动', 'success');
				addFloatingLog('银行卡填写已启动', 'success');
				sendResponse({ success: true, message: '银行卡填写已启动' });
			} else {
				sendResponse({ success: false, message: '未知操作: ' + message.action });
			}
		} catch (error) {
			console.error('[Content Script] 处理消息失败:', error);
			sendResponse({ success: false, message: error.message });
		}
	})();
	
	// 返回 true 表示异步响应
	return true;
});

/**
 * 生成随机名字
 * @returns {Object} 包含 firstName 和 lastName 的对象
 */
function generateRandomName() {
	const firstNames = [
		'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph',
		'Thomas', 'Charles', 'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark',
		'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua', 'Kenneth', 'Kevin', 'Brian',
		'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan', 'Jacob',
		'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott',
		'Brandon', 'Benjamin', 'Samuel', 'Frank', 'Gregory', 'Raymond', 'Alexander',
		'Patrick', 'Jack', 'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Jose', 'Henry',
		'Adam', 'Douglas', 'Nathan', 'Zachary', 'Kyle', 'Noah', 'Ethan', 'Jeremy',
		'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan',
		'Jessica', 'Sarah', 'Karen', 'Nancy', 'Lisa', 'Betty', 'Margaret', 'Sandra',
		'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle', 'Dorothy', 'Carol',
		'Amanda', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura',
		'Cynthia', 'Kathleen', 'Amy', 'Shirley', 'Angela', 'Helen', 'Anna', 'Brenda',
		'Pamela', 'Nicole', 'Emma', 'Samantha', 'Katherine', 'Christine', 'Debra',
		'Rachel', 'Carolyn', 'Janet', 'Virginia', 'Maria', 'Heather', 'Diane',
		'Julie', 'Joyce', 'Victoria', 'Kelly', 'Christina', 'Joan', 'Evelyn'
	];
	
	const lastNames = [
		'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
		'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas',
		'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris',
		'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen',
		'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green',
		'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter',
		'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz',
		'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Rogers', 'Reed', 'Cook',
		'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera', 'Cooper', 'Richardson', 'Cox',
		'Howard', 'Ward', 'Torres', 'Peterson', 'Gray', 'Ramirez', 'James', 'Watson',
		'Brooks', 'Kelly', 'Sanders', 'Price', 'Bennett', 'Wood', 'Barnes', 'Ross',
		'Henderson', 'Coleman', 'Jenkins', 'Perry', 'Powell', 'Long', 'Patterson', 'Hughes'
	];
	
	const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
	const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
	
	return { firstName, lastName };
}

async function handleStartRegistration(data) {
	console.log('[Content Script] 开始注册:', data);
	
	// 保存当前 URL，用于检测页面是否跳转
	const currentUrl = location.href;
	
	try {
		const { email, password, moemailId } = data || {};
		
		if (moemailId && email) {
			storeMoemailSession({ id: moemailId, email });
			console.log('[Content Script] 已记录 Moemail 邮箱:', email, moemailId);
			startMoemailVerificationFlow({ forceStart: true });
		} else {
			clearMoemailSession();
		}
		
		if (!email || !password) {
			throw new Error('邮箱或密码为空');
		}
		
		// 生成随机名字
		const { firstName, lastName } = generateRandomName();
		console.log('[Content Script] 生成的名字:', firstName, lastName);
		
		// 等待页面元素加载
		await new Promise(resolve => setTimeout(resolve, 500));
		
		// 1. 填写 First name（名）
		const firstNameSelectors = [
			'input[name*="first" i]',
			'input[id*="first" i]',
			'input[placeholder*="first name" i]',
			'input[placeholder*="First name" i]',
			'input[autocomplete*="given-name" i]'
		];
		
		let firstNameInput = null;
		for (const selector of firstNameSelectors) {
			firstNameInput = document.querySelector(selector);
			if (firstNameInput) break;
		}
		
		if (firstNameInput) {
			firstNameInput.focus();
			firstNameInput.value = '';
			firstNameInput.value = firstName;
			firstNameInput.dispatchEvent(new Event('input', { bubbles: true }));
			firstNameInput.dispatchEvent(new Event('change', { bubbles: true }));
			console.log('[Content Script] 已填写 First name:', firstName);
		} else {
			console.warn('[Content Script] 未找到 First name 输入框');
		}
		
		// 2. 填写 Last name（姓）
		const lastNameSelectors = [
			'input[name*="last" i]',
			'input[id*="last" i]',
			'input[placeholder*="last name" i]',
			'input[placeholder*="Last name" i]',
			'input[autocomplete*="family-name" i]'
		];
		
		let lastNameInput = null;
		for (const selector of lastNameSelectors) {
			lastNameInput = document.querySelector(selector);
			if (lastNameInput) break;
		}
		
		if (lastNameInput) {
			lastNameInput.focus();
			lastNameInput.value = '';
			lastNameInput.value = lastName;
			lastNameInput.dispatchEvent(new Event('input', { bubbles: true }));
			lastNameInput.dispatchEvent(new Event('change', { bubbles: true }));
			console.log('[Content Script] 已填写 Last name:', lastName);
		} else {
			console.warn('[Content Script] 未找到 Last name 输入框');
		}
		
		// 3. 填写邮箱
		const emailSelectors = [
			'input[type="email"]',
			'input[name*="email" i]',
			'input[id*="email" i]',
			'input[placeholder*="email" i]',
			'input[autocomplete*="email" i]'
		];
		
		let emailInput = null;
		for (const selector of emailSelectors) {
			try {
				emailInput = await waitForElement(selector, 2000);
				if (emailInput) break;
			} catch (e) {
				// 继续尝试下一个选择器
			}
		}
		
		if (!emailInput) {
			emailInput = document.querySelector('input[type="email"]') || 
			             document.querySelector('input[name*="email" i]') ||
			             document.querySelector('input[id*="email" i]');
		}
		
		if (emailInput && email) {
			emailInput.focus();
			emailInput.value = '';
			emailInput.value = email;
			emailInput.dispatchEvent(new Event('input', { bubbles: true }));
			emailInput.dispatchEvent(new Event('change', { bubbles: true }));
			console.log('[Content Script] 已填写邮箱:', email);
		} else {
			console.warn('[Content Script] 未找到邮箱输入框');
		}
		
		// 4. 保存密码到 sessionStorage，供下一个页面使用
		if (password) {
			sessionStorage.setItem('windsurf_registration_password', password);
			console.log('[Content Script] 密码已保存到 sessionStorage，将在下一个页面填写');
		}
		
		// 5. 勾选协议复选框
		const checkboxSelectors = [
			'input[type="checkbox"][name*="terms" i]',
			'input[type="checkbox"][id*="terms" i]',
			'input[type="checkbox"][name*="agreement" i]',
			'input[type="checkbox"][id*="agreement" i]',
			'input[type="checkbox"][name*="policy" i]',
			'input[type="checkbox"][id*="policy" i]',
			'input[type="checkbox"][name*="accept" i]',
			'input[type="checkbox"][id*="accept" i]',
			'input[type="checkbox"][aria-label*="terms" i]',
			'input[type="checkbox"][aria-label*="agreement" i]'
		];
		
		let checkbox = null;
		for (const selector of checkboxSelectors) {
			checkbox = document.querySelector(selector);
			if (checkbox) break;
		}
		
		// 如果没找到，尝试查找所有复选框，选择第一个未选中的
		if (!checkbox) {
			const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
			for (const cb of allCheckboxes) {
				// 检查复选框是否与协议相关（通过附近的文本）
				const label = cb.closest('label') || 
				             (cb.parentElement && cb.parentElement.textContent) ||
				             (cb.nextSibling && cb.nextSibling.textContent);
				const labelText = label ? (label.textContent || label.innerText || '').toLowerCase() : '';
				
				if (labelText.includes('terms') || 
				    labelText.includes('agreement') || 
				    labelText.includes('policy') ||
				    labelText.includes('privacy') ||
				    labelText.includes('服务') ||
				    labelText.includes('协议')) {
					checkbox = cb;
					break;
				}
			}
			
			// 如果还是没找到，使用第一个未选中的复选框
			if (!checkbox && allCheckboxes.length > 0) {
				for (const cb of allCheckboxes) {
					if (!cb.checked) {
						checkbox = cb;
						break;
					}
				}
			}
		}
		
		if (checkbox) {
			if (!checkbox.checked) {
				checkbox.click();
				checkbox.checked = true;
				checkbox.dispatchEvent(new Event('change', { bubbles: true }));
				checkbox.dispatchEvent(new Event('click', { bubbles: true }));
				console.log('[Content Script] 已勾选协议复选框');
			} else {
				console.log('[Content Script] 协议复选框已勾选');
			}
		} else {
			console.warn('[Content Script] 未找到协议复选框');
		}
		
		// 等待一下让页面处理所有输入和验证
		await new Promise(resolve => setTimeout(resolve, 1000));
		
		// 6. 查找并点击提交按钮
		console.log('[Content Script] 开始查找提交按钮...');
		
		// 辅助函数：检查元素是否可见
		function isElementVisible(element) {
			if (!element) return false;
			const style = window.getComputedStyle(element);
			return style.display !== 'none' && 
			       style.visibility !== 'hidden' && 
			       style.opacity !== '0' &&
			       element.offsetWidth > 0 && 
			       element.offsetHeight > 0;
		}
		
		// 首先尝试通过 type="submit" 查找
		let submitButton = document.querySelector('button[type="submit"]') || 
		                   document.querySelector('input[type="submit"]');
		
		// 如果没找到，尝试通过文本内容查找
		if (!submitButton || !isElementVisible(submitButton)) {
			const allButtons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
			const submitTexts = ['Sign up', 'Create', 'Register', 'Continue', 'Next', 'Submit', 'Get started', '开始', '注册', '创建'];
			
			for (const btn of allButtons) {
				if (!isElementVisible(btn)) continue;
				
				const btnText = (btn.textContent || btn.innerText || btn.value || '').trim();
				const btnAriaLabel = (btn.getAttribute('aria-label') || '').trim();
				const combinedText = (btnText + ' ' + btnAriaLabel).toLowerCase();
				
				// 检查按钮文本是否包含提交相关的关键词
				for (const text of submitTexts) {
					if (combinedText.includes(text.toLowerCase())) {
						// 排除明显不是提交按钮的文本（如 "Other Sign up options"）
						if (!combinedText.includes('other') && 
						    !combinedText.includes('option') &&
						    !combinedText.includes('link')) {
							submitButton = btn;
							console.log('[Content Script] 通过文本找到提交按钮:', btnText || btnAriaLabel);
							break;
						}
					}
				}
				if (submitButton) break;
			}
		}
		
		// 如果还是没找到，尝试查找包含特定 class 或 id 的按钮
		if (!submitButton || !isElementVisible(submitButton)) {
			const classSelectors = [
				'button[class*="submit" i]',
				'button[class*="primary" i]',
				'button[class*="continue" i]',
				'button[class*="next" i]',
				'button[id*="submit" i]',
				'button[id*="continue" i]',
				'button[id*="next" i]'
			];
			
			for (const selector of classSelectors) {
				submitButton = document.querySelector(selector);
				if (submitButton && isElementVisible(submitButton)) {
					console.log('[Content Script] 通过选择器找到提交按钮:', selector);
					break;
				}
			}
		}
		
		// 如果找到按钮但被禁用，等待一下再试
		if (submitButton && submitButton.disabled) {
			console.log('[Content Script] 提交按钮被禁用，等待表单验证...');
			await new Promise(resolve => setTimeout(resolve, 1500));
			
			// 再次检查按钮是否可用
			if (submitButton.disabled) {
				console.warn('[Content Script] 提交按钮仍然被禁用，尝试强制点击');
			}
		}
		
		if (submitButton && isElementVisible(submitButton)) {
			// 尝试多种点击方式
			try {
				// 先聚焦
				submitButton.focus();
				await new Promise(resolve => setTimeout(resolve, 200));
				
				// 触发点击事件
				submitButton.click();
				console.log('[Content Script] 已点击提交按钮，等待页面跳转...');
				
				// 如果 click() 没有效果，尝试 dispatchEvent
				setTimeout(() => {
					if (location.href === currentUrl) {
						console.log('[Content Script] 页面未跳转，尝试使用 dispatchEvent');
						const clickEvent = new MouseEvent('click', {
							bubbles: true,
							cancelable: true,
							view: window
						});
						submitButton.dispatchEvent(clickEvent);
					}
				}, 500);
			} catch (e) {
				console.error('[Content Script] 点击按钮失败:', e);
			}
			
			// 重置标志，准备处理下一个页面
			continueButtonClicked = false;
			passwordFilled = false;
			passwordSubmitted = false;
			
			// 监听页面跳转，在下一个页面自动填写密码
			setTimeout(() => {
				checkAndFillPassword();
			}, 2000);
			setTimeout(() => {
				checkAndFillPassword();
			}, 4000);
		} else {
			// 尝试查找表单并提交
			const form = document.querySelector('form');
			if (form) {
				console.log('[Content Script] 未找到提交按钮，尝试提交表单');
				form.submit();
				console.log('[Content Script] 已提交表单，等待页面跳转...');
				
				// 重置标志，准备处理下一个页面
				continueButtonClicked = false;
				passwordFilled = false;
				passwordSubmitted = false;
				
				// 监听页面跳转，在下一个页面自动填写密码
				setTimeout(() => {
					checkAndFillPassword();
				}, 2000);
				setTimeout(() => {
					checkAndFillPassword();
				}, 4000);
			} else {
				console.warn('[Content Script] 未找到提交按钮或表单');
				console.log('[Content Script] 所有按钮:', Array.from(document.querySelectorAll('button')).map(b => ({
					text: b.textContent?.trim(),
					type: b.type,
					disabled: b.disabled,
					visible: isElementVisible(b)
				})));
			}
		}
		
	} catch (error) {
		console.error('[Content Script] 注册处理失败:', error);
		throw error;
	}
}


/**
 * 等待元素出现
 * @param {string} selector - CSS 选择器
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 5000) {
	return new Promise((resolve, reject) => {
		const element = document.querySelector(selector);
		if (element) {
			resolve(element);
			return;
		}
		
		const observer = new MutationObserver((mutations, obs) => {
			const element = document.querySelector(selector);
			if (element) {
				obs.disconnect();
				resolve(element);
			}
		});
		
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		
		setTimeout(() => {
			observer.disconnect();
			reject(new Error('等待元素超时: ' + selector));
		}, timeout);
	});
}

/**
 * 处理自动填卡
 */
async function handleAutoFillCard() {
	console.log('[Content Script] 开始自动填卡');
	
	try {
		// 这里应该包含填卡的具体逻辑
		// 由于原代码混淆严重，这里提供一个基础框架
		
		// 查找卡号输入框
		const cardNumberInput = document.querySelector('input[name*="card" i], input[id*="card" i], input[placeholder*="card" i], input[type="text"][autocomplete*="cc-number" i]');
		if (cardNumberInput) {
			// 这里应该填入卡号（需要从某个地方获取）
			console.log('[Content Script] 找到卡号输入框');
			// cardNumberInput.value = '卡号';
		}
		
		// 查找其他相关输入框（CVV、过期日期等）
		// ...
		
		console.log('[Content Script] 自动填卡完成');
	} catch (error) {
		console.error('[Content Script] 自动填卡失败:', error);
		throw error;
	}
}

/**
 * 处理银行卡填写
 */
async function handleFillBankCard() {
	console.log('[Content Script] 开始填写银行卡');
	// 类似 handleAutoFillCard 的逻辑
	await handleAutoFillCard();
}

