/**
 * 公告管理器
 * 负责获取、缓存和管理公告信息
 */
class NoticeManager {
	/**
	 * 获取公告（优先返回缓存，后台更新）
	 * @returns {Promise<Object|null>} 公告数据或null
	 */
	async getNotice() {
		try {
			// 先获取缓存
			const cachedNotice = await this.getCachedNotice();
			
			// 后台异步更新（不阻塞）
			this.fetchAndUpdateNotice().catch(error => {
				console.warn('[公告] 后台更新失败:', error);
				// 后台更新失败不影响使用，静默处理
			});

			// 如果有缓存，立即返回
			if (cachedNotice) {
				return cachedNotice;
			}

			// 没有缓存，等待获取
			return await this.fetchAndUpdateNotice();
		} catch (error) {
			console.error('[公告] 获取公告失败:', error);
			// 尝试返回缓存
			try {
				return await this.getCachedNotice();
			} catch (cacheError) {
				console.error('[公告] 获取缓存也失败:', cacheError);
				return null;
			}
		}
	}

	/**
	 * 获取缓存的公告
	 * @returns {Promise<Object|null>} 缓存的公告数据或null
	 */
	async getCachedNotice() {
		try {
			const cached = await StorageManager.get(STORAGE_KEYS.NOTICE_CACHE);
			
			// 验证缓存数据格式
			if (cached && typeof cached === 'object') {
				return cached;
			}
			
			return null;
		} catch (error) {
			console.error('[公告] 读取缓存失败:', error);
			return null;
		}
	}

	/**
	 * 获取并更新公告
	 * @returns {Promise<Object|null>} 公告数据或null
	 */
	async fetchAndUpdateNotice() {
		try {
			const response = await cardKeyAPI.getConfig();
			
			// 验证响应格式
			if (!response || typeof response !== 'object') {
				throw new Error('服务器返回数据格式错误');
			}

			if (response.status !== 1 || !response.result) {
				throw new Error('服务器返回数据异常: status=' + response.status);
			}

			const noticeData = response.result;
			const timestamp = response.ts;

			// 验证时间戳
			if (!timestamp) {
				console.warn('[公告] 服务器未返回时间戳');
			}

			// 检查是否需要更新
			const needUpdate = await this.compareAndCheckUpdate(noticeData, timestamp);
			
			if (needUpdate) {
				try {
					await this.saveNoticeCache(noticeData, timestamp);
					this.notifyUIUpdate(noticeData);
				} catch (saveError) {
					console.error('[公告] 保存缓存失败:', saveError);
					// 保存失败不影响返回数据
				}
			}

			return noticeData;
		} catch (error) {
			console.error('[公告] 获取失败:', error);
			
			// 尝试返回缓存作为降级方案
			const cached = await this.getCachedNotice();
			if (cached) {
				console.info('[公告] 使用缓存数据');
				return cached;
			}
			
			// 没有缓存，返回null
			return null;
		}
	}

	/**
	 * 比较并检查是否需要更新
	 * @param {Object} newData - 新的公告数据
	 * @param {string|number} newTimestamp - 新的时间戳
	 * @returns {Promise<boolean>} 是否需要更新
	 */
	async compareAndCheckUpdate(newData, newTimestamp) {
		try {
			const storageData = await StorageManager.get([
				STORAGE_KEYS.NOTICE_CACHE,
				STORAGE_KEYS.NOTICE_TIMESTAMP
			]);

			const cachedData = storageData[STORAGE_KEYS.NOTICE_CACHE];
			const cachedTimestamp = storageData[STORAGE_KEYS.NOTICE_TIMESTAMP];

			// 如果没有缓存，需要更新
			if (!cachedData) {
				return true;
			}

			// 如果时间戳不同，需要更新
			if (cachedTimestamp !== newTimestamp) {
				return true;
			}

			// 比较公告内容
			const newNotice = newData?.notice;
			const cachedNotice = cachedData?.notice;

			if (!cachedNotice) {
				return true;
			}

			// 比较公告字段
			const noticeFields = [
				'title', 'message', 'positiveText', 'cancelText', 
				'neutralText', 'ext', 'cancelExt', 'neutralExt'
			];

			for (const field of noticeFields) {
				if (newNotice?.[field] !== cachedNotice[field]) {
					return true;
				}
			}

			// 比较注册信息
			const newRegister = newData?.register;
			const cachedRegister = cachedData?.register;

			if (newRegister?.message !== cachedRegister?.message) {
				return true;
			}

			// 内容相同，不需要更新
			return false;
		} catch (error) {
			console.error('[公告] 对比失败:', error);
			// 出错时默认需要更新，确保数据最新
			return true;
		}
	}

	/**
	 * 保存公告缓存
	 * @param {Object} noticeData - 公告数据
	 * @param {string|number} timestamp - 时间戳
	 * @returns {Promise<void>}
	 * @throws {Error} 保存失败时抛出错误
	 */
	async saveNoticeCache(noticeData, timestamp) {
		if (!noticeData || typeof noticeData !== 'object') {
			throw new Error('公告数据格式错误');
		}

		try {
			await StorageManager.setBatch({
				[STORAGE_KEYS.NOTICE_CACHE]: noticeData,
				[STORAGE_KEYS.NOTICE_TIMESTAMP]: timestamp,
				[STORAGE_KEYS.NOTICE_LAST_FETCH]: new Date().toISOString()
			});
		} catch (error) {
			console.error('[公告] 保存缓存失败:', error);
			throw new Error('保存公告缓存失败: ' + error.message);
		}
	}

	/**
	 * 通知UI更新
	 * @param {Object} noticeData - 公告数据
	 */
	notifyUIUpdate(noticeData) {
		try {
			if (typeof document !== 'undefined' && document.dispatchEvent) {
				const event = new CustomEvent('noticeUpdated', {
					detail: {
						notice: noticeData
					}
				});
				document.dispatchEvent(event);
			}
		} catch (error) {
			console.error('[公告] 通知UI更新失败:', error);
			// 通知失败不影响功能，静默处理
		}
	}

	/**
	 * 清除缓存
	 * @returns {Promise<void>}
	 */
	async clearCache() {
		try {
			await StorageManager.remove([
				STORAGE_KEYS.NOTICE_CACHE,
				STORAGE_KEYS.NOTICE_TIMESTAMP,
				STORAGE_KEYS.NOTICE_LAST_FETCH
			]);
		} catch (error) {
			console.error('[公告] 清除缓存失败:', error);
			throw new Error('清除公告缓存失败: ' + error.message);
		}
	}

	/**
	 * 强制刷新公告
	 * @returns {Promise<Object|null>} 公告数据或null
	 */
	async forceRefresh() {
		try {
			await this.clearCache();
			return await this.fetchAndUpdateNotice();
		} catch (error) {
			console.error('[公告] 强制刷新失败:', error);
			throw error;
		}
	}
}

const noticeManager = new NoticeManager();