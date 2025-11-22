/**
 * Moemail API Service
 * 提供创建、查询和删除 moemail.app 临时邮箱的统一接口
 */
(function initMoemailService(globalScope) {
	const CONFIG = {
		BASE_URL: 'https://moemail.app/api/emails',
		API_KEY: '',
		DEFAULT_DOMAIN: 'moemail.app',
		DEFAULT_EXPIRY: 3600000 // 1 小时
	};
	
	function logMessage(logFn, type, message) {
		if (typeof logFn === 'function') {
			try {
				logFn(type, message);
			} catch (error) {
				console.warn('[Moemail] 日志回调失败:', error);
			}
		} else {
			console.log(`[Moemail][${type}] ${message}`);
		}
	}
	
	async function getApiKey() {
		return new Promise((resolve) => {
			if (typeof chrome !== 'undefined' && chrome.storage) {
				chrome.storage.local.get(['moemail_api_key'], (result) => {
					resolve(result.moemail_api_key || CONFIG.API_KEY);
				});
			} else {
				// 兼容其他环境
				const apiKey = localStorage.getItem('moemail_api_key') || CONFIG.API_KEY;
				resolve(apiKey);
			}
		});
	}

	function buildHeaders(includeJson = false) {
		return getApiKey().then(apiKey => {
			const headers = {
				'X-API-Key': apiKey
			};
			
			if (includeJson) {
				headers['Content-Type'] = 'application/json; charset=utf-8';
			}
			
			return headers;
		});
	}
	
	function generateRandomAlphaNumeric(length = 8) {
		const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
		let result = '';
		
		for (let i = 0; i < length; i++) {
			result += chars[Math.floor(Math.random() * chars.length)];
		}
		
		return result;
	}
	
	function extractDigits(text = '') {
		const matches = text.match(/\d+/g);
		return matches ? matches.join('') : '';
	}
	
	async function createEmail(options = {}) {
		const { name, expiryTime = CONFIG.DEFAULT_EXPIRY, domain = CONFIG.DEFAULT_DOMAIN, log } = options;
		
		const maxAttempts = 5;
		let attempt = 0;
		let lastError = null;
		
		while (attempt < maxAttempts) {
			const currentName = attempt === 0 && name ? name : generateRandomAlphaNumeric(12);
			const payload = {
				name: currentName,
				expiryTime,
				domain
			};
			
			const headers = await buildHeaders(true);
			const response = await fetch(`${CONFIG.BASE_URL}/generate`, {
				method: 'POST',
				headers: headers,
				body: JSON.stringify(payload)
			});
			
			const responseText = await response.text();
			
			if (response.ok) {
				let data = null;
				try {
					data = JSON.parse(responseText);
				} catch (error) {
					throw new Error('Moemail 返回数据解析失败: ' + error.message);
				}
				
				if (!data?.email || !data?.id) {
					throw new Error('Moemail 返回数据缺少 email 或 id 字段');
				}
				
				logMessage(log, 'success', `邮箱创建成功: ${data.email}`);
				
				return {
					email: data.email.replace(/"/g, ''),
					id: data.id.replace(/"/g, ''),
					raw: data
				};
			}
			
			lastError = new Error(`Moemail 创建失败: ${response.status} ${response.statusText} - ${responseText}`);
			
			if (response.status === 409) {
				logMessage(log, 'warn', `邮箱名称已被占用，正在重试...（第 ${attempt + 1} 次）`);
				attempt += 1;
				continue;
			}
			
			throw lastError;
		}
		
		throw lastError || new Error('Moemail 创建失败：多次尝试仍未成功，请稍后重试');
	}
	
	async function fetchMessages(emailId, cursor = '', options = {}) {
		const { log } = options;
		
		if (!emailId) {
			throw new Error('Moemail 邮箱 ID 不能为空');
		}
		
		const headers = await buildHeaders(false);
		const url = `${CONFIG.BASE_URL}/${encodeURIComponent(emailId)}?cursor=${encodeURIComponent(cursor || '')}`;
		const response = await fetch(url, {
			method: 'GET',
			headers: headers
		});
		
		const responseBuffer = await response.arrayBuffer();
		const decoder = new TextDecoder('utf-8');
		const responseText = decoder.decode(responseBuffer);
		
		if (!response.ok) {
			throw new Error(`Moemail 获取邮件失败: ${response.status} ${response.statusText} - ${responseText}`);
		}
		
		let data = null;
		try {
			data = JSON.parse(responseText);
		} catch (error) {
			throw new Error('Moemail 邮件数据解析失败: ' + error.message);
		}
		
		const messages = Array.isArray(data?.messages) ? data.messages : [];
		const latestMessage = messages[0] || null;
		const latestCode = latestMessage ? extractDigits(latestMessage.subject || latestMessage.text || '') : '';
		
		if (latestMessage) {
			logMessage(log, 'success', '获取到最新邮件');
		} else {
			logMessage(log, 'info', '暂无新邮件');
		}
		
		return {
			messages,
			cursor: data?.cursor || data?.nextCursor || '',
			latestCode,
			latestMessage,
			raw: data
		};
	}
	
	async function deleteEmail(emailId, options = {}) {
		const { log } = options;
		
		if (!emailId) {
			throw new Error('Moemail 邮箱 ID 不能为空');
		}
		
		const headers = await buildHeaders(false);
		const url = `${CONFIG.BASE_URL}/${encodeURIComponent(emailId)}`;
		const response = await fetch(url, {
			method: 'DELETE',
			headers: headers
		});
		
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Moemail 删除失败: ${response.status} ${response.statusText} - ${text}`);
		}
		
		logMessage(log, 'success', `邮箱已删除: ${emailId}`);
	}
	
	const MoemailService = {
		CONFIG,
		generateRandomAlphaNumeric,
		extractDigits,
		buildHeaders,
		createEmail,
		fetchMessages,
		deleteEmail
	};
	
	globalScope.MoemailService = MoemailService;
})(typeof self !== 'undefined' ? self : this);

