/**
 * 工具函数库
 * 包含去混淆后的核心工具函数
 */

const MOEMAIL_DOMAIN = 'moemail.app';

// 全局 elements 对象（将在初始化时填充）
let elements = {};
let currentMoemailAccount = null;

// 默认配置（使用函数来延迟初始化，避免在函数定义之前调用）
function getDefaultConfig() {
	return {
		'emailPrefix': generateRandomEmailPrefix(),
		'password': generateRandomPassword()
	};
}

// 为了兼容性，也导出一个对象（在函数定义后初始化）
let DEFAULT_CONFIG = null;

/**
 * 生成随机密码
 * @param {number} length - 密码长度，默认12-16位
 * @returns {string} 随机密码
 */
function generateRandomPassword(length = null) {
	const lowercase = 'abcdefghijklmnopqrstuvwxyz';
	const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	const numbers = '0123456789';
	const special = '!@#$%^&*';
	
	const allChars = lowercase + uppercase + numbers + special;
	let password = '';
	
	// 随机长度：12-16位
	const passwordLength = length || Math.floor(Math.random() * 5) + 12;
	
	// 确保至少包含每种类型的字符
	password += lowercase[Math.floor(Math.random() * lowercase.length)];
	password += uppercase[Math.floor(Math.random() * uppercase.length)];
	password += numbers[Math.floor(Math.random() * numbers.length)];
	password += special[Math.floor(Math.random() * special.length)];
	
	// 填充剩余字符
	for (let i = password.length; i < passwordLength; i++) {
		password += allChars[Math.floor(Math.random() * allChars.length)];
	}
	
	// 打乱字符顺序
	return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * 生成随机字母数字字符串
 * @param {number} length - 字符串长度
 * @returns {string} 随机字符串
 */
function generateRandomAlphaNumeric(length = 8) {
	const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let result = '';
	
	for (let i = 0; i < length; i++) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	
	return result;
}

/**
 * 生成随机邮箱前缀（大小写字母 + 数字，长度随机）
 * @returns {string} 随机邮箱前缀
 */
function generateRandomEmailPrefix() {
	const length = Math.floor(Math.random() * 5) + 12; // 8-12 位
	return generateRandomAlphaNumeric(length);
}

/**
 * 与后台通信的通用封装
 * @param {string} type - 消息类型
 * @param {Object} payload - 消息数据
 * @returns {Promise<any>}
 */
function sendBackgroundMessage(type, payload = {}) {
	return new Promise((resolve, reject) => {
		if (!chrome?.runtime?.sendMessage) {
			reject(new Error('后台通信不可用'));
			return;
		}
		
		chrome.runtime.sendMessage({ type, payload }, (response) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
				return;
			}
			resolve(response);
		});
	});
}

/**
 * 使用指定邮箱更新 UI 显示
 * @param {string} email - 完整邮箱
 */
function applyMoemailEmailToUI(email) {
	if (!elements || !email) {
		return;
	}
	
	const localPart = email.split('@')[0] || '';
	
	if (elements.emailPrefix) {
		elements.emailPrefix.value = localPart;
	}
	if (elements.emailPreview) {
		elements.emailPreview.textContent = email;
	}
	
	try {
		updateEmailPreview();
	} catch (error) {
		console.warn('[工具] 更新邮箱预览失败:', error);
	}
}

/**
 * 创建 Moemail 邮箱并更新 UI
 * @param {string} nameHint - 可选的名称提示
 * @returns {Promise<{email: string, id: string, raw: any}>}
 */
async function createMoemailAccount(nameHint = '') {
	const fallbackName = nameHint && nameHint.trim() ? nameHint.trim() : generateRandomEmailPrefix();
	
	addLog('正在创建 Moemail 邮箱...', 'info');
	updateStatus('正在创建临时邮箱...', 'running');
	
	const response = await sendBackgroundMessage('moemailCreate', { name: fallbackName });
	
	if (!response?.success || !response.data) {
		throw new Error(response?.error || 'Moemail 创建失败');
	}
	
	currentMoemailAccount = response.data;
	applyMoemailEmailToUI(currentMoemailAccount.email);
	updateStatus('Moemail 邮箱已创建', 'success');
	addLog(`Moemail 邮箱已创建：${currentMoemailAccount.email}`, 'success');
	
	return currentMoemailAccount;
}

/**
 * 更新状态显示
 * @param {string} message - 状态消息
 * @param {string} type - 状态类型：'success', 'error', 'running', 默认'info'
 */
function updateStatus(message, type = 'info') {
	if (!elements || !elements.status) {
		console.warn('[工具] elements.status 未初始化');
		return;
	}
	
	try {
		elements.status.textContent = message;
		elements.status.className = 'status ' + type;
	} catch (error) {
		console.error('[工具] 更新状态失败:', error);
	}
}

/**
 * 添加日志
 * @param {string} message - 日志消息
 * @param {string} type - 日志类型：'info', 'success', 'error', 默认'info'
 */
function addLog(message, type = 'info') {
	if (!elements || !elements.log) {
		console.warn('[工具] elements.log 未初始化');
		return;
	}
	
	try {
		const logEntry = document.createElement('div');
		logEntry.className = 'log-entry ' + type;
		
		const timestamp = new Date().toLocaleTimeString('zh-CN', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		
		logEntry.textContent = `[${timestamp}] ${message}`;
		elements.log.appendChild(logEntry);
		
		// 自动滚动到底部
		elements.log.scrollTop = elements.log.scrollHeight;
		
		// 限制日志条数，避免内存泄漏
		const maxLogs = 100;
		const logEntries = elements.log.querySelectorAll('.log-entry');
		if (logEntries.length > maxLogs) {
			logEntries[0].remove();
		}
	} catch (error) {
		console.error('[工具] 添加日志失败:', error);
	}
}

/**
 * 获取当前邮箱域名
 * @returns {string} 邮箱域名
 */
function getCurrentDomain() {
	return MOEMAIL_DOMAIN;
}

/**
 * 更新邮箱预览
 */
function updateEmailPreview() {
	if (!elements || !elements.emailPreview) {
		return;
	}
	
	try {
		const prefix = elements.emailPrefix?.value || 'windsurf';
		const domain = getCurrentDomain();
		
		if (domain !== MOEMAIL_DOMAIN) {
			currentMoemailAccount = null;
		}
		
		const email = `${prefix}@${domain}`;
		elements.emailPreview.textContent = email;
	} catch (error) {
		console.error('[工具] 更新邮箱预览失败:', error);
	}
}

/**
 * 切换自定义域名输入框显示
 */
/**
 * 切换密码显示/隐藏
 */
function togglePasswordVisibility() {
	if (!elements || !elements.password || !elements.togglePassword) {
		return;
	}
	
	try {
		const isPassword = elements.password.type === 'password';
		elements.password.type = isPassword ? 'text' : 'password';
		elements.togglePassword.textContent = isPassword ? '🙈' : '👁️';
	} catch (error) {
		console.error('[工具] 切换密码显示失败:', error);
	}
}

/**
 * 生成新密码并更新到输入框
 */
function generateNewPassword() {
	try {
		const newPassword = generateRandomPassword();
		
		if (elements && elements.password) {
			elements.password.value = newPassword;
			// 确保密码类型正确
			if (elements.password.type === 'text') {
				elements.password.type = 'password';
				if (elements.togglePassword) {
					elements.togglePassword.textContent = '👁️';
				}
			}
		}
		
		updateStatus('密码已生成', 'success');
		addLog('新密码已生成: ' + newPassword, 'success');
		
		// 2秒后清除状态
		setTimeout(() => {
			updateStatus('等待开始...', 'info');
		}, 2000);
	} catch (error) {
		console.error('[工具] 生成新密码失败:', error);
		updateStatus('生成密码失败', 'error');
	}
}

/**
 * 生成新邮箱前缀并更新到输入框
 */
function generateNewEmailPrefix() {
	try {
		const newPrefix = generateRandomEmailPrefix();
		
		if (elements && elements.emailPrefix) {
			elements.emailPrefix.value = newPrefix;
		}
		
		updateEmailPreview();
		updateStatus('邮箱前缀已生成', 'success');
		addLog('新邮箱前缀已生成: ' + newPrefix, 'success');
		
		// 2秒后清除状态
		setTimeout(() => {
			updateStatus('等待开始...', 'info');
		}, 2000);
	} catch (error) {
		console.error('[工具] 生成新邮箱前缀失败:', error);
		updateStatus('生成邮箱前缀失败', 'error');
	}
}

/**
 * 加载配置
 */
async function loadConfig() {
	try {
		const savedConfig = await chrome.storage.local.get(DEFAULT_CONFIG);
		const config = { ...DEFAULT_CONFIG, ...savedConfig };
		
		// 如果没有保存的邮箱前缀，生成一个新的
		if (!config.emailPrefix) {
			config.emailPrefix = generateRandomEmailPrefix();
		}
		
		// 更新UI元素
		if (elements) {
			if (elements.emailPrefix) {
				elements.emailPrefix.value = config.emailPrefix || generateRandomEmailPrefix();
			}
			if (elements.password) {
				elements.password.value = config.password || generateRandomPassword();
			}
		}
		
		updateEmailPreview();
		
		addLog('配置已加载', 'success');
	} catch (error) {
		console.error('[工具] 加载配置失败:', error);
		addLog('加载配置失败: ' + error.message, 'error');
	}
}

/**
 * 保存配置
 */
async function saveConfig() {
	try {
		if (!elements) {
			throw new Error('元素未初始化');
		}
		
		const config = {
			emailPrefix: elements.emailPrefix?.value || '',
			password: elements.password?.value || ''
		};
		
		// 同时保存API Key
		const apiKeyInput = document.getElementById('moemailApiKey');
		if (apiKeyInput && apiKeyInput.value) {
			try {
				if (typeof ApiKeyManager !== 'undefined' && ApiKeyManager.saveMoemailApiKey) {
					await ApiKeyManager.saveMoemailApiKey(apiKeyInput.value);
				}
			} catch (error) {
				console.warn('[工具] 保存API Key失败:', error);
			}
		}
		
		await chrome.storage.local.set(config);
		updateStatus('配置已保存', 'success');
		addLog('配置已保存', 'success');
	} catch (error) {
		console.error('[工具] 保存配置失败:', error);
		updateStatus('保存配置失败: ' + error.message, 'error');
		addLog('保存配置失败: ' + error.message, 'error');
	}
}

/**
 * 绑定事件监听器
 */
function bindEventListeners() {
	if (!elements) {
		console.error('[工具] elements 未初始化');
		return;
	}
	
	try {
		// 邮箱前缀输入框 - 更新预览
		if (elements.emailPrefix) {
			elements.emailPrefix.addEventListener('input', updateEmailPreview);
		}
		
		// 密码显示/隐藏切换按钮
		if (elements.togglePassword) {
			elements.togglePassword.addEventListener('click', togglePasswordVisibility);
		}
		
		// 生成新密码按钮
		if (elements.generatePassword) {
			elements.generatePassword.addEventListener('click', generateNewPassword);
		}
		
		// 生成新邮箱前缀按钮
		if (elements.generatePrefix) {
			elements.generatePrefix.addEventListener('click', generateNewEmailPrefix);
		}
		
		// 打开注册页面按钮
		if (elements.openPageBtn) {
			elements.openPageBtn.addEventListener('click', openRegistrationPage);
		}
		
		// 保存配置按钮
		if (elements.saveConfigBtn) {
			elements.saveConfigBtn.addEventListener('click', saveConfig);
		}
		
		// 导出账号按钮
		if (elements.exportAccountsBtn) {
			elements.exportAccountsBtn.addEventListener('click', exportAccountsToDesktop);
		}
		
		// 开始注册按钮
		if (elements.startBtn) {
			elements.startBtn.addEventListener('click', startRegistration);
		}
		
		// 自动填卡按钮
		if (elements.autoFillCardBtn) {
			elements.autoFillCardBtn.addEventListener('click', autoFillCard);
		}
		
		// 复制邮箱按钮
		const copyBtn = document.querySelector('.copy-btn');
		if (copyBtn) {
			copyBtn.addEventListener('click', copyEmailToClipboard);
		}
		
		// 生成邮箱密码按钮
		if (elements.generateEmailPassword) {
			elements.generateEmailPassword.addEventListener('click', generateNewEmailPassword);
		}
		
		// 测试API Key按钮
		if (elements.testApiKey) {
			elements.testApiKey.addEventListener('click', testMoemailApiKey);
		}
		
		// 清空日志按钮
		if (elements.clearLog) {
			elements.clearLog.addEventListener('click', clearLog);
		}
		
		// 使用说明折叠/展开
		const helpHeader = document.querySelector('.help-header');
		if (helpHeader) {
			helpHeader.addEventListener('click', toggleHelp);
		}
		
		console.log('[工具] 事件监听器已绑定');
	} catch (error) {
		console.error('[工具] 绑定事件监听器失败:', error);
	}
}

/**
 * 检查并打开注册页面
 * 如果当前标签页已经是注册页面，则直接使用；否则打开新标签页
 */
async function checkAndOpenRegistrationPage() {
	try {
		const queryOptions = { active: true, currentWindow: true };
		const [currentTab] = await chrome.tabs.query(queryOptions);
		
		if (!currentTab || !currentTab.url) {
			updateStatus('无法获取当前标签页信息', 'error');
			return;
		}
		
		const currentUrl = currentTab.url;
		
		// 检查是否是注册页面
		if (currentUrl.includes('windsurf.com/account/register') || 
		    currentUrl.includes('codeium.com/account/register')) {
			addLog('当前页面已是注册页面', 'success');
			updateStatus('当前页面已是注册页面', 'success');
			return;
		}
		
		// 检查是否是 Windsurf 或 Codeium 的其他页面
		if (currentUrl.includes('windsurf.com') || currentUrl.includes('codeium.com')) {
			addLog('正在打开注册页面...', 'info');
			updateStatus('正在打开注册页面...', 'running');
			await openRegistrationPage();
			return;
		}
		
		// 其他页面，提示用户
		updateStatus('请先打开 Windsurf 或 Codeium 网站', 'error');
	} catch (error) {
		console.error('[工具] 检查注册页面失败:', error);
		updateStatus('检查注册页面失败: ' + error.message, 'error');
	}
}

/**
 * 打开注册页面
 */
async function openRegistrationPage() {
	try {
		addLog('正在打开注册页面...', 'info');
		updateStatus('正在打开注册页面...', 'running');
		
		const createOptions = {
			url: 'https://windsurf.com/account/register',
			active: true
		};
		
		await chrome.tabs.create(createOptions);
		
		addLog('注册页面已打开', 'success');
		updateStatus('注册页面已打开', 'success');
		
		// 延迟后检查页面是否加载完成
		setTimeout(async () => {
			try {
				const queryOptions = { url: 'https://windsurf.com/account/register' };
				const tabs = await chrome.tabs.query(queryOptions);
				
				if (tabs && tabs.length > 0) {
					const tab = tabs[0];
					if (tab.status === 'complete') {
						updateStatus('页面已加载完成', 'success');
					} else {
						// 监听标签页更新
						const listener = (tabId, changeInfo) => {
							if (tabId === tab.id && changeInfo.status === 'complete') {
								updateStatus('页面已加载完成', 'success');
								chrome.tabs.onUpdated.removeListener(listener);
							}
						};
						chrome.tabs.onUpdated.addListener(listener);
					}
				}
			} catch (error) {
				console.error('[工具] 检查页面加载状态失败:', error);
			}
		}, 1000);
	} catch (error) {
		console.error('[工具] 打开注册页面失败:', error);
		addLog('打开注册页面失败: ' + error.message, 'error');
		updateStatus('打开注册页面失败: ' + error.message, 'error');
	}
}

/**
 * 导出账号到桌面
 */
async function exportAccountsToDesktop() {
	try {
		addLog('正在导出账号...', 'info');
		
		// 获取保存的账号列表
		const result = await chrome.storage.local.get(['savedAccounts']);
		const savedAccounts = result.savedAccounts || [];
		
		if (savedAccounts.length === 0) {
			addLog('没有可导出的账号', 'error');
			updateStatus('没有可导出的账号', 'error');
			return;
		}
		
		// 准备导出数据
		const exportData = {
			accounts: savedAccounts,
			exportTime: new Date().toISOString(),
			total: savedAccounts.length
		};
		
		// 转换为 JSON 字符串
		const jsonContent = JSON.stringify(exportData, null, 2);
		
		// 创建 Blob
		const blob = new Blob([jsonContent], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		
		// 生成文件名（包含时间戳）
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
		const filename = `windsurf-accounts-${timestamp}.json`;
		
		// 下载文件
		const downloadOptions = {
			url: url,
			filename: filename,
			saveAs: true
		};
		
		chrome.downloads.download(downloadOptions, (downloadId) => {
			if (chrome.runtime.lastError) {
				const error = chrome.runtime.lastError.message;
				console.error('[工具] 下载失败:', error);
				addLog('导出失败: ' + error, 'error');
				updateStatus('导出失败: ' + error, 'error');
				URL.revokeObjectURL(url);
			} else {
				addLog(`成功导出 ${savedAccounts.length} 个账号`, 'success');
				updateStatus(`成功导出 ${savedAccounts.length} 个账号`, 'success');
				
				// 延迟清理 URL
				setTimeout(() => {
					URL.revokeObjectURL(url);
				}, 5000);
			}
		});
	} catch (error) {
		console.error('[工具] 导出账号失败:', error);
		addLog('导出账号失败: ' + error.message, 'error');
		updateStatus('导出账号失败: ' + error.message, 'error');
	}
}

/**
 * 等待页面加载完成
 * @param {number} tabId - 标签页ID
 * @returns {Promise<void>}
 */
async function waitForPageLoad(tabId) {
	return new Promise((resolve) => {
		const listener = (updatedTabId, changeInfo) => {
			if (updatedTabId === tabId && changeInfo.status === 'complete') {
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		};
		
		chrome.tabs.onUpdated.addListener(listener);
		
		// 检查页面是否已经加载完成
		chrome.tabs.get(tabId, (tab) => {
			if (tab && tab.status === 'complete') {
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		});
	});
}

/**
 * 注入并执行脚本
 * @param {number} tabId - 标签页ID
 * @param {string} action - 要执行的操作
 * @param {Object} data - 要传递的数据
 * @returns {Promise<any>}
 */
async function injectAndExecute(tabId, action, data = {}) {
	try {
		const message = {
			action: action,
			data: data
		};
		
		// 先尝试发送消息（如果 content script 已加载）
		return new Promise((resolve, reject) => {
			chrome.tabs.sendMessage(tabId, message, (response) => {
				if (chrome.runtime.lastError) {
					// 如果消息发送失败，等待一下再重试（给 content script 时间加载）
					console.warn('[工具] 消息发送失败，等待 content script 加载:', chrome.runtime.lastError.message);
					
					setTimeout(() => {
						chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
							if (chrome.runtime.lastError) {
								reject(new Error('无法连接到 content script: ' + chrome.runtime.lastError.message + '。请确保页面已完全加载。'));
							} else {
								resolve(retryResponse);
							}
						});
					}, 1000);
				} else {
					resolve(response);
				}
			});
		});
	} catch (error) {
		console.error('[工具] 注入脚本失败:', error);
		throw error;
	}
}

/**
 * 开始自动注册流程
 */
async function startRegistration() {
	try {
		// 获取表单数据
		if (!elements) {
			updateStatus('元素未初始化', 'error');
			return;
		}
		
		let emailPrefix = elements.emailPrefix?.value?.trim() || '';
		const password = elements.password?.value || '';
		const domain = getCurrentDomain();
		
		// 验证输入
		if (!emailPrefix && domain !== MOEMAIL_DOMAIN) {
			updateStatus('邮箱前缀不能为空', 'error');
			return;
		}
		
		if (!password || password.length < 8) {
			updateStatus('密码至少需要8位', 'error');
			return;
		}
		
		// 获取当前标签页
		const queryOptions = { active: true, currentWindow: true };
		const [currentTab] = await chrome.tabs.query(queryOptions);
		
		if (!currentTab) {
			updateStatus('无法获取当前标签页', 'error');
			return;
		}
		
		// 检查是否是注册页面
		const currentUrl = currentTab.url || '';
		const isRegisterPage = currentUrl.includes('windsurf.com/account/register') || 
		                       currentUrl.includes('codeium.com/account/register');
		
		let targetTab = currentTab;
		
		// 如果不是注册页面，打开注册页面
		if (!isRegisterPage) {
			addLog('当前页面不是注册页面，正在打开注册页面...', 'info');
			await openRegistrationPage();
			
			// 等待新标签页打开
			await new Promise(resolve => setTimeout(resolve, 1000));
			
			// 获取新打开的标签页
			const tabs = await chrome.tabs.query({ url: 'https://windsurf.com/account/register' });
			if (tabs && tabs.length > 0) {
				targetTab = tabs[0];
			}
		}
		
		let moemailAccount = null;
		if (domain === MOEMAIL_DOMAIN) {
			try {
				moemailAccount = await createMoemailAccount(emailPrefix);
				emailPrefix = moemailAccount.email.split('@')[0] || emailPrefix;
			} catch (error) {
				console.error('[工具] 创建 Moemail 邮箱失败:', error);
				updateStatus('创建 Moemail 邮箱失败: ' + error.message, 'error');
				return;
			}
		}
		
		// 保存配置（确保 UI 值已更新）
		await saveConfig();
		
		// 构建完整邮箱地址
		const email = moemailAccount ? moemailAccount.email : `${emailPrefix}@${domain}`;
		
		// 更新状态
		updateStatus('正在开始注册...', 'running');
		addLog('开始注册，邮箱: ' + email, 'info');
		
		// 准备注册数据
		const registrationData = {
			email: email,
			password: password,
			moemailId: moemailAccount?.id || null
		};
		
		// 等待页面加载完成
		await waitForPageLoad(targetTab.id);
		
		// 先显示浮动面板
		try {
			await injectAndExecute(targetTab.id, 'showFloatingPanel');
		} catch (e) {
			console.warn('[工具] 无法显示浮动面板:', e);
		}
		
		// 向 content script 发送消息开始注册
		addLog('正在向页面发送注册指令...', 'info');
		await injectAndExecute(targetTab.id, 'startRegistration', registrationData);
		
		addLog('注册流程已启动', 'success');
		updateStatus('注册流程已启动', 'success');
		
		// 更新邮箱序号（为下次注册做准备）
		if (!moemailAccount) {
			await saveConfig();
		}
	} catch (error) {
		console.error('[工具] 开始注册失败:', error);
		addLog('开始注册失败: ' + error.message, 'error');
		updateStatus('开始注册失败: ' + error.message, 'error');
	}
}

/**
 * 复制邮箱到剪贴板
 */
async function copyEmailToClipboard() {
	try {
		const email = elements.emailPreview?.textContent || '';
		if (!email) {
			updateStatus('没有可复制的邮箱', 'error');
			return;
		}
		
		await navigator.clipboard.writeText(email);
		updateStatus('邮箱已复制到剪贴板', 'success');
		addLog(`邮箱已复制: ${email}`, 'success');
		
		// 2秒后清除状态
		setTimeout(() => {
			updateStatus('等待开始...', 'info');
		}, 2000);
	} catch (error) {
		console.error('[工具] 复制邮箱失败:', error);
		updateStatus('复制失败: ' + error.message, 'error');
		addLog('复制邮箱失败: ' + error.message, 'error');
	}
}

/**
 * 生成新邮箱密码并更新到输入框
 */
function generateNewEmailPassword() {
	try {
		const newPassword = generateRandomPassword();
		
		if (elements && elements.emailPassword) {
			elements.emailPassword.value = newPassword;
			// 确保密码类型正确
			if (elements.emailPassword.type === 'text') {
				elements.emailPassword.type = 'password';
			}
		}
		
		updateStatus('邮箱密码已生成', 'success');
		addLog('新邮箱密码已生成', 'success');
		
		// 2秒后清除状态
		setTimeout(() => {
			updateStatus('等待开始...', 'info');
		}, 2000);
	} catch (error) {
		console.error('[工具] 生成邮箱密码失败:', error);
		updateStatus('生成邮箱密码失败', 'error');
	}
}

/**
 * 测试 Moemail API Key
 */
async function testMoemailApiKey() {
	try {
		const apiKeyInput = document.getElementById('moemailApiKey');
		const apiKey = apiKeyInput?.value?.trim() || '';
		
		if (!apiKey) {
			updateStatus('请先输入 API Key', 'error');
			addLog('API Key 为空，无法测试', 'error');
			return;
		}
		
		updateStatus('正在测试 API Key...', 'running');
		addLog('正在测试 API Key...', 'info');
		
		// 尝试创建一个测试邮箱来验证 API Key
		const response = await sendBackgroundMessage('moemailCreate', { name: 'test' });
		
		if (response?.success) {
			updateStatus('API Key 测试成功', 'success');
			addLog('API Key 验证通过', 'success');
			
			// 删除测试邮箱
			if (response.data?.id) {
				try {
					await sendBackgroundMessage('moemailDelete', { emailId: response.data.id });
				} catch (e) {
					console.warn('[工具] 删除测试邮箱失败:', e);
				}
			}
		} else {
			updateStatus('API Key 测试失败', 'error');
			addLog('API Key 验证失败: ' + (response?.error || '未知错误'), 'error');
		}
		
		// 3秒后清除状态
		setTimeout(() => {
			updateStatus('等待开始...', 'info');
		}, 3000);
	} catch (error) {
		console.error('[工具] 测试 API Key 失败:', error);
		updateStatus('测试失败: ' + error.message, 'error');
		addLog('测试 API Key 失败: ' + error.message, 'error');
		
		// 3秒后清除状态
		setTimeout(() => {
			updateStatus('等待开始...', 'info');
		}, 3000);
	}
}

/**
 * 清空日志
 */
function clearLog() {
	try {
		if (elements && elements.log) {
			elements.log.innerHTML = '';
			addLog('日志已清空', 'info');
		}
	} catch (error) {
		console.error('[工具] 清空日志失败:', error);
	}
}

/**
 * 切换使用说明显示/隐藏
 */
function toggleHelp() {
	const helpContent = document.getElementById('helpContent');
	if (helpContent) {
		if (helpContent.style.display === 'none' || helpContent.style.display === '') {
			helpContent.style.display = 'block';
		} else {
			helpContent.style.display = 'none';
		}
	}
}

/**
 * 自动填卡功能
 */
async function autoFillCard() {
	try {
		addLog('正在启动自动填卡...', 'info');
		
		// 获取当前标签页
		const queryOptions = { active: true, currentWindow: true };
		const [currentTab] = await chrome.tabs.query(queryOptions);
		
		let targetTab = null;
		
		if (currentTab && currentTab.url && 
		    (currentTab.url.includes('windsurf.com/billing') || 
		     currentTab.url.includes('codeium.com/billing'))) {
			// 当前页面已经是 billing 页面
			addLog('当前页面已是账单页面', 'success');
			updateStatus('当前页面已是账单页面', 'success');
			targetTab = currentTab;
			
			// 等待页面加载完成
			await waitForPageLoad(targetTab.id);
			
			// 直接执行填卡
			addLog('正在执行填卡...', 'info');
			await injectAndExecute(targetTab.id, 'autoFillCard');
			return;
		}
		
		// 需要打开 billing 页面
		if (currentTab) {
			targetTab = currentTab;
		} else {
			// 创建新标签页
			const newTab = await chrome.tabs.create({ url: 'https://windsurf.com/billing/individual?plan=2', active: true });
			targetTab = newTab;
		}
		
		// 打开 billing 页面
		const updateOptions = {
			url: 'https://windsurf.com/billing/individual?plan=2',
			active: true
		};
		
		await chrome.tabs.update(targetTab.id, updateOptions);
		addLog('已打开账单页面', 'success');
		
		// 等待页面加载完成
		await waitForPageLoad(targetTab.id);
		
		// 执行填卡
		// 先显示浮动面板
		try {
			await injectAndExecute(targetTab.id, 'showFloatingPanel');
		} catch (e) {
			console.warn('[工具] 无法显示浮动面板:', e);
		}
		
		addLog('页面加载完成，正在执行填卡...', 'success');
		await injectAndExecute(targetTab.id, 'autoFillCard');
		
		addLog('自动填卡完成', 'success');
		updateStatus('自动填卡完成', 'success');
	} catch (error) {
		console.error('[工具] 自动填卡失败:', error);
		addLog('自动填卡失败: ' + error.message, 'error');
		updateStatus('自动填卡失败: ' + error.message, 'error');
	}
}

/**
 * 初始化插件
 * 初始化 elements 对象并调用必要的初始化函数
 */
async function initPopup() {
	try {
		// 初始化 DEFAULT_CONFIG
		if (!DEFAULT_CONFIG) {
			DEFAULT_CONFIG = getDefaultConfig();
		}
		
		// 初始化 DOM 元素引用
		elements = {
			'emailPrefix': document.getElementById('emailPrefix'),
			'password': document.getElementById('password'),
			'emailPassword': document.getElementById('emailPassword'),
			'emailPreview': document.getElementById('emailPreview'),
			'togglePassword': document.getElementById('togglePassword'),
			'generatePassword': document.getElementById('generatePassword'),
			'generatePrefix': document.getElementById('generatePrefix'),
			'generateEmailPassword': document.getElementById('generateEmailPassword'),
			'startBtn': document.getElementById('startBtn'),
			'autoFillCardBtn': document.getElementById('autoFillCardBtn'),
			'openPageBtn': document.getElementById('openPageBtn'),
			'saveConfigBtn': document.getElementById('saveConfigBtn'),
			'status': document.getElementById('status'),
			'log': document.getElementById('log'),
			'exportAccountsBtn': document.getElementById('exportAccountsBtn'),
			'saveConfigBtn': document.getElementById('saveConfigBtn'),
			'testApiKey': document.getElementById('testApiKey'),
			'clearLog': document.getElementById('clearLog')
		};
		
		// 加载配置
		await loadConfig();
		
		// 绑定事件监听器
		bindEventListeners();
		
		// 检查并打开注册页面（如果需要）
		await checkAndOpenRegistrationPage();
		
		// 加载并显示公告
		if (typeof loadAndDisplayNotice === 'function') {
			await loadAndDisplayNotice();
		}
		
		console.log('[工具] 插件初始化完成');
	} catch (error) {
		console.error('[工具] 插件初始化失败:', error);
	}
}

// DOM 加载完成后自动初始化
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initPopup);
} else {
	// DOM 已经加载完成，直接初始化
	initPopup();
}

