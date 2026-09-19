import AppKit
import Darwin

// Keep the user's complete clipboard in memory while the isolated Paste trial runs.
// A concurrent clipboard change takes precedence over restoring the saved contents.
let board = NSPasteboard.general
let originalChange = board.changeCount
var saved: [[NSPasteboard.PasteboardType: Data]] = []
var totalBytes = 0
var totalTypes = 0
for item in board.pasteboardItems ?? [] {
    var copy: [NSPasteboard.PasteboardType: Data] = [:]
    for type in item.types {
        guard let data = item.data(forType: type) else { exit(2) }
        totalTypes += 1
        totalBytes += data.count
        guard totalTypes <= 64 && totalBytes <= 8 * 1024 * 1024 else { exit(2) }
        copy[type] = data
    }
    saved.append(copy)
}
guard board.changeCount == originalChange else { exit(2) }
func restore(_ expectedChange: Int) {
    guard board.changeCount == expectedChange else {
        print("preserved-newer-clipboard")
        return
    }
    let items = saved.map { values -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in values { item.setData(data, forType: type) }
        return item
    }
    board.clearContents()
    if !items.isEmpty { board.writeObjects(items) }
    print("restored")
}
board.clearContents()
guard board.setString(" — żółw UTF-8 🧪", forType: .string) else {
    restore(board.changeCount)
    exit(2)
}
let fixtureChange = board.changeCount
print("ready")
fflush(stdout)
var input = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
_ = poll(&input, 1, 120_000)
restore(fixtureChange)
