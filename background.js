/**
 * 后台服务脚本
 * 处理扩展的后台任务和消息传递
 */

importScripts('moemail-service.js');

// 监听扩展安装
chrome.runtime.onInstalled.addListener((details) => {
	if (details.reason === 'install') {
		console.log('[扩展] 首次安装');
	} else if (details.reason === 'update') {
		console.log('[扩展] 更新到新版本:', details.previousVersion);
	}
});

// 监听扩展图标点击事件，打开独立窗口（这样点击页面时不会关闭）
chrome.action.onClicked.addListener(async (tab) => {
	try {
		// 检查是否已经有打开的窗口
		const windows = await chrome.windows.getAll();
		const existingWindow = windows.find(win => 
			win.type === 'popup' && 
			win.url && 
			win.url.includes('popup.html')
		);
		
		if (existingWindow) {
			// 如果窗口已存在，聚焦到该窗口
			await chrome.windows.update(existingWindow.id, { focused: true });
			console.log('[扩展] 聚焦到已存在的窗口');
		} else {
			// 创建新窗口
			const newWindow = await chrome.windows.create({
				url: chrome.runtime.getURL('popup.html'),
				type: 'popup',
				width: 450,
				height: 700,
				focused: true
			});
			console.log('[扩展] 创建新窗口:', newWindow.id);
		}
	} catch (error) {
		console.error('[扩展] 打开窗口失败:', error);
	}
});

function logMoemail(type, message) {
	const timestamp = new Date().toISOString();
	console.log(`[Moemail][${timestamp}][${type}] ${message}`);
}

async function handleMoemailRequest(request) {
	const payload = request.payload || {};
	
	if (!MoemailService) {
		throw new Error('Moemail 服务未初始化');
	}
	
	if (request.type === 'moemailCreate') {
		const name = payload.name || MoemailService.generateRandomAlphaNumeric(10);
		return MoemailService.createEmail({ name, log: logMoemail });
	}
	
	if (request.type === 'moemailFetchMessages') {
		const { emailId, cursor } = payload;
		return MoemailService.fetchMessages(emailId, cursor || '', { log: logMoemail });
	}
	
	if (request.type === 'moemailDelete') {
		const { emailId } = payload;
		await MoemailService.deleteEmail(emailId, { log: logMoemail });
		return { deleted: true };
	}
	
	return null;
}

// 监听来自 content script 或 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	const { type } = request || {};
	
	if (!type) {
		sendResponse({ success: false, error: '缺少消息类型' });
		return false;
	}
	
	if (type === 'ping') {
			sendResponse({ success: true, message: 'pong' });
			return true;
		}

	if (type.startsWith('moemail')) {
		(async () => {
			try {
				const result = await handleMoemailRequest(request);
				sendResponse({ success: true, data: result });
			} catch (error) {
				console.error('[后台] 处理 Moemail 请求失败:', error);
				sendResponse({ success: false, error: error.message });
			}
		})();
		return true;
	}
	
	// 其他消息
	try {
		console.log('[后台] 收到消息:', request);
		sendResponse({ success: true });
	} catch (error) {
		console.error('[后台] 处理消息失败:', error);
		sendResponse({ success: false, error: error.message });
	}
	
	return true; // 保持消息通道开放以支持异步响应
});

// 错误处理
self.addEventListener('error', (event) => {
	console.error('[后台] 发生错误:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
	console.error('[后台] 未处理的 Promise 拒绝:', event.reason);
});

