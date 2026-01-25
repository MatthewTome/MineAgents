const REQUEST_EXPIRY_MS = 120000;
export class ResourceProtocol {
    requests = new Map();
    offers = new Map();
    myName;
    myRole;
    constructor(name, role) {
        this.myName = name;
        this.myRole = role;
    }
    setRole(role) {
        this.myRole = role;
    }
    createRequest(item, count, urgent = false) {
        const request = {
            id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            requester: this.myName,
            requesterRole: this.myRole,
            item,
            count,
            urgent,
            timestamp: Date.now(),
            status: "pending"
        };
        this.requests.set(request.id, request);
        return request;
    }
    formatRequestMessage(request) {
        const urgency = request.urgent ? "[URGENT] " : "";
        return `${urgency}[team] ${request.requester} (${request.requesterRole}) needs ${request.count} ${request.item}`;
    }
    parseRequestFromChat(message, senderName) {
        const teamNeedsMatch = message.match(/\[team\]\s*(\w+)\s*\((\w+)\)\s*needs?\s*(\d+)?\s*(.+)/i);
        if (teamNeedsMatch) {
            const request = {
                id: `parsed-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                requester: teamNeedsMatch[1],
                requesterRole: teamNeedsMatch[2],
                item: teamNeedsMatch[4].trim(),
                count: parseInt(teamNeedsMatch[3]) || 1,
                urgent: message.includes("[URGENT]"),
                timestamp: Date.now(),
                status: "pending"
            };
            this.requests.set(request.id, request);
            return request;
        }
        const simpleNeedsMatch = message.match(/needs?\s+(?:more\s+)?(\d+)?\s*(\w+)/i);
        if (simpleNeedsMatch) {
            const request = {
                id: `parsed-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                requester: senderName,
                item: simpleNeedsMatch[2],
                count: parseInt(simpleNeedsMatch[1]) || 1,
                urgent: message.includes("[URGENT]"),
                timestamp: Date.now(),
                status: "pending"
            };
            this.requests.set(request.id, request);
            return request;
        }
        return null;
    }
    parseOfferFromChat(message, senderName) {
        const chestMatch = message.match(/\[team\].*deposited?\s*(\d+)?\s*(\w+).*chest.*at\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/i);
        if (chestMatch) {
            const offer = {
                id: `offer-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                offerer: senderName,
                item: chestMatch[2],
                count: parseInt(chestMatch[1]) || 1,
                method: "chest",
                location: {
                    x: parseInt(chestMatch[3]),
                    y: parseInt(chestMatch[4]),
                    z: parseInt(chestMatch[5])
                },
                timestamp: Date.now(),
                status: "available"
            };
            this.offers.set(offer.id, offer);
            return offer;
        }
        const tossMatch = message.match(/\[team\].*tossed?\s*(\d+)?\s*(\w+).*to\s*(\w+)/i);
        if (tossMatch) {
            const offer = {
                id: `offer-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                offerer: senderName,
                item: tossMatch[2],
                count: parseInt(tossMatch[1]) || 1,
                method: "drop",
                timestamp: Date.now(),
                status: "delivered"
            };
            this.offers.set(offer.id, offer);
            return offer;
        }
        return null;
    }
    claimRequest(requestId) {
        const request = this.requests.get(requestId);
        if (!request || request.status !== "pending") {
            return false;
        }
        request.status = "claimed";
        request.claimedBy = this.myName;
        return true;
    }
    fulfillRequest(requestId) {
        const request = this.requests.get(requestId);
        if (!request || request.claimedBy !== this.myName) {
            return false;
        }
        request.status = "fulfilled";
        return true;
    }
    getPendingRequests() {
        const now = Date.now();
        const pending = [];
        for (const request of this.requests.values()) {
            if (request.status === "pending") {
                if (now - request.timestamp > REQUEST_EXPIRY_MS) {
                    request.status = "expired";
                }
                else if (request.requester !== this.myName) {
                    pending.push(request);
                }
            }
        }
        return pending.sort((a, b) => {
            if (a.urgent && !b.urgent)
                return -1;
            if (!a.urgent && b.urgent)
                return 1;
            return a.timestamp - b.timestamp;
        });
    }
    getMyPendingRequests() {
        return Array.from(this.requests.values()).filter(r => r.requester === this.myName && r.status === "pending");
    }
    getAvailableOffers() {
        return Array.from(this.offers.values()).filter(o => o.status === "available");
    }
    cleanupExpired() {
        const now = Date.now();
        for (const [id, request] of this.requests) {
            if (now - request.timestamp > REQUEST_EXPIRY_MS) {
                this.requests.delete(id);
            }
        }
        for (const [id, offer] of this.offers) {
            if (now - offer.timestamp > REQUEST_EXPIRY_MS) {
                this.offers.delete(id);
            }
        }
    }
    canIHelpWith(request) {
        if (request.requester === this.myName) {
            return false;
        }
        if (this.myRole === "gatherer") {
            return true;
        }
        if (this.myRole === "generalist") {
            return true;
        }
        if (this.myRole === "supervisor") {
            return true;
        }
        return false;
    }
}
