import type { CreateBidAttrs, Bid } from '$services/types';
import { client, withLock } from '$services/redis';
import { bidHistoryKey, itemsKey, itemsByPriceKey } from '$services/keys';
import { DateTime } from 'luxon';
import { getItem } from '$services/queries/items'

export const createBid = async (attrs: CreateBidAttrs) => {
	return withLock(attrs.itemId, async (signal: any) => {
		const item = await getItem(attrs.itemId);

		if (!item) {
			throw new Error('item does not exist');
		}
		if (attrs.amount < item.price) {
			throw new Error('bid too low');
		}
		if (item.endingAt.diff(DateTime.now()).toMillis() < 0 ) {
			throw new Error('item closed to bidding');
		}

		const serialized = serializeHistory(attrs.amount, attrs.createdAt.toMillis());

		if (signal.expired) {
			throw new Error('lock expired');
		}

		return Promise.all([
			client.rPush(bidHistoryKey(attrs.itemId), serialized),
			client.hSet(itemsKey(attrs.itemId), {
				bids: item.bids + 1,
				price: attrs.amount,
				highestBidUserId: attrs.userId,
			}),
			client.zIncrBy(itemsByPriceKey(), attrs.amount, attrs.itemId)
		]);
	});
};

export const getBidHistory = async (itemId: string, offset = 0, count = 10): Promise<Bid[]> => {
	const startIndex = -1 * offset - count;
	const endIndex = -1 - offset;

	const range = await client.lRange(bidHistoryKey(itemId), startIndex, endIndex);

	return range.map(bid => deserializeHistory(bid));
};

const serializeHistory = (amount: number, createdAt: number) => {
	return `${amount}:${createdAt}`;
};

const deserializeHistory = (stored: string) => {
	const [amount, createdAt] = stored.split(':');

	return {
		amount: parseFloat(amount),
		createdAt: DateTime.fromMillis(parseInt(createdAt)),
	};
};
