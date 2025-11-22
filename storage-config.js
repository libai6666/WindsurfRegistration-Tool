/**
 * 存储键名常量
 */
const STORAGE_KEYS = {
	DEVICE_CODE: 'windsurf_device_code',
	CARD_KEY: 'windsurf_card_key',
	EXPIRE_TIME: 'windsurf_expire_time',
	VERIFIED: 'windsurf_verified',
	VERIFIED_AT: 'windsurf_verified_at',
	NOTICE_CACHE: 'windsurf_notice_cache',
	NOTICE_TIMESTAMP: 'windsurf_notice_timestamp',
	NOTICE_LAST_FETCH: 'windsurf_notice_last_fetch',
	APP_CONFIG: 'windsurf_app_config',
	USER_SETTINGS: 'windsurf_user_settings'
};

/**
 * 存储管理器
 * 封装 Chrome Storage API，提供错误处理
 */
class StorageManager {
	/**
	 * 设置单个存储项
	 * @param {string} key - 存储键
	 * @param {*} value - 存储值
	 * @returns {Promise<void>}
	 * @throws {Error} 存储失败时抛出错误
	 */
	static async set(key, value) {
		if (!key || typeof key !== 'string') {
			throw new Error('存储键必须是有效的字符串');
		}

		try {
			await chrome.storage.local.set({
				[key]: value
			});
		} catch (error) {
			console.error('[存储] 设置失败:', error);
			throw new Error(`保存数据失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 获取存储项
	 * @param {string|string[]} keys - 存储键或键数组
	 * @returns {Promise<*>} 存储值或对象
	 * @throws {Error} 获取失败时抛出错误
	 */
	static async get(keys) {
		if (!keys) {
			throw new Error('存储键不能为空');
		}

		try {
			const result = await chrome.storage.local.get(keys);
			
			// 如果传入单个字符串，返回对应的值
			if (typeof keys === 'string') {
				return result[keys];
			}
			
			// 如果传入数组，返回对象
			return result;
		} catch (error) {
			console.error('[存储] 获取失败:', error);
			throw new Error(`读取数据失败: ${error.message || '未知错误'}`);
		}
	}
	
	/**
	 * 删除存储项
	 * @param {string|string[]} keys - 存储键或键数组
	 * @returns {Promise<void>}
	 * @throws {Error} 删除失败时抛出错误
	 */
	static async remove(keys) {
		if (!keys) {
			throw new Error('存储键不能为空');
		}

		try {
			await chrome.storage.local.remove(keys);
		} catch (error) {
			console.error('[存储] 删除失败:', error);
			throw new Error(`删除数据失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 清空所有存储
	 * @returns {Promise<void>}
	 * @throws {Error} 清空失败时抛出错误
	 */
	static async clear() {
		try {
			await chrome.storage.local.clear();
		} catch (error) {
			console.error('[存储] 清空失败:', error);
			throw new Error(`清空存储失败: ${error.message || '未知错误'}`);
		}
	}

	/**
	 * 批量设置存储项
	 * @param {Object} items - 键值对对象
	 * @returns {Promise<void>}
	 * @throws {Error} 设置失败时抛出错误
	 */
	static async setBatch(items) {
		if (!items || typeof items !== 'object') {
			throw new Error('批量设置的数据必须是对象');
		}

		try {
			await chrome.storage.local.set(items);
		} catch (error) {
			console.error('[存储] 批量设置失败:', error);
			throw new Error(`批量保存数据失败: ${error.message || '未知错误'}`);
		}
	}
}

/**
 * API Key 管理器
 * 提供 Moemail API Key 的存储和获取功能
 */
class ApiKeyManager {
	/**
	 * 保存 Moemail API Key
	 * @param {string} apiKey - API Key
	 * @returns {Promise<void>}
	 */
	static async saveMoemailApiKey(apiKey) {
		if (typeof chrome !== 'undefined' && chrome.storage) {
			return StorageManager.set('moemail_api_key', apiKey);
		} else {
			// 兼容其他环境
			localStorage.setItem('moemail_api_key', apiKey);
			return Promise.resolve();
		}
	}

	/**
	 * 获取 Moemail API Key
	 * @returns {Promise<string>} API Key
	 */
	static async getMoemailApiKey() {
		if (typeof chrome !== 'undefined' && chrome.storage) {
			const value = await StorageManager.get('moemail_api_key');
			return value || '';
		} else {
			// 兼容其他环境
			return localStorage.getItem('moemail_api_key') || '';
		}
	}

	/**
	 * 删除 Moemail API Key
	 * @returns {Promise<void>}
	 */
	static async removeMoemailApiKey() {
		if (typeof chrome !== 'undefined' && chrome.storage) {
			return StorageManager.remove('moemail_api_key');
		} else {
			// 兼容其他环境
			localStorage.removeItem('moemail_api_key');
			return Promise.resolve();
		}
	}
}

// 在页面加载完成后，从缓存中读取API Key并填充到输入框
if (typeof document !== 'undefined') {
	document.addEventListener('DOMContentLoaded', async function() {
		try {
			const savedApiKey = await ApiKeyManager.getMoemailApiKey();
			const apiKeyInput = document.getElementById('moemailApiKey');
			if (apiKeyInput) {
				apiKeyInput.value = savedApiKey;
			}
		} catch (error) {
			console.error('获取保存的API Key失败:', error);
		}
	});
}