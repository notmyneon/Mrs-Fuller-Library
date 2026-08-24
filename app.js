(() => {
  const STORAGE_KEY = "classroomLibraryMVP_v1";
  const DEFAULT_DUE_DAYS = 14;

  const state = loadState();
  let recentIds = [];
  let selectedStudentId = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function loadState() {
    const fallback = { books: [], students: [], loans: [], settings: { dueDays: DEFAULT_DUE_DAYS } };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return parsed && parsed.books && parsed.students && parsed.loans ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  }

  function cleanCode(value) {
    return String(value || "").trim().replace(/[^0-9A-Za-z-]/g, "");
  }

  function normalizeISBN(value) {
    return String(value || "").trim().replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  function isLikelyISBN(value) {
    const v = normalizeISBN(value);
    return v.length === 10 || v.length === 13;
  }

  function uid(prefix) {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}-${random[0].toString(36).toUpperCase()}${random[1].toString(36).toUpperCase()}`.slice(0, 18);
  }

  function nextStudentCode() {
    const used = new Set(state.students.map(s => s.code));
    let n = state.students.length + 1;
    let code;
    do {
      code = `STU-${String(n).padStart(4, "0")}`;
      n++;
    } while (used.has(code));
    return code;
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDaysISO(days) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || DEFAULT_DUE_DAYS));
    return d.toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function currentLoanForBook(bookId) {
    return state.loans.find(l => l.bookId === bookId && !l.returnDate) || null;
  }

  function currentLoans() {
    return state.loans.filter(l => !l.returnDate);
  }

  function bookByCode(raw) {
    const code = normalizeISBN(raw);
    return state.books.find(b => normalizeISBN(b.isbn) === code) || null;
  }

  function studentByCode(raw) {
    const code = cleanCode(raw).toUpperCase();
    return state.students.find(s => s.code.toUpperCase() === code) || null;
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function showView(name) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
    if (name === "scan") setTimeout(() => $("#scanIsbn")?.focus(), 50);
    if (name === "circulation") setTimeout(() => $("#checkoutStudent")?.focus(), 50);
  }

  $$(".tab").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
  $$("[data-go]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.go)));

  async function lookupOpenLibrary(isbn) {
    const key = `ISBN:${isbn}`;
    const url = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&jscmd=data&format=json`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });

    if (!response.ok) {
      throw new Error(`Open Library returned ${response.status}.`);
    }

    const data = await response.json();
    const v = data[key];
    if (!v) return null;

    const identifiers = v.identifiers || {};
    const isbn13 = identifiers.isbn_13?.[0];
    const isbn10 = identifiers.isbn_10?.[0];

    return {
      id: uid("BOOK"),
      isbn: normalizeISBN(isbn13 || isbn10 || isbn),
      scannedIsbn: isbn,
      googleVolumeId: null,
      metadataSource: "Open Library",
      title: v.title || "Untitled",
      subtitle: v.subtitle || "",
      authors: (v.authors || []).map(a => a.name).filter(Boolean),
      publisher: v.publishers?.[0]?.name || "",
      publishedDate: v.publish_date || "",
      description: typeof v.excerpts?.[0]?.text === "string" ? v.excerpts[0].text : "",
      pageCount: v.number_of_pages || null,
      categories: (v.subjects || []).slice(0, 12).map(s => s.name).filter(Boolean),
      image: (v.cover?.medium || v.cover?.large || v.cover?.small || v.thumbnail_url || "").replace("http://", "https://"),
      dateAdded: todayISO()
    };
  }

  async function lookupGoogleBooks(isbn) {
    const q = encodeURIComponent(`isbn:${isbn}`);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books`;
    const response = await fetch(url);

    if (!response.ok) {
      const err = new Error(`Google Books returned ${response.status}.`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    if (!data.items?.length) return null;

    const exact = data.items.find(item =>
      (item.volumeInfo?.industryIdentifiers || []).some(x => normalizeISBN(x.identifier) === isbn)
    ) || data.items[0];

    const v = exact.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    const isbn13 = ids.find(x => x.type === "ISBN_13")?.identifier;
    const isbn10 = ids.find(x => x.type === "ISBN_10")?.identifier;

    return {
      id: uid("BOOK"),
      isbn: normalizeISBN(isbn13 || isbn10 || isbn),
      scannedIsbn: isbn,
      googleVolumeId: exact.id || null,
      metadataSource: "Google Books",
      title: v.title || "Untitled",
      subtitle: v.subtitle || "",
      authors: v.authors || [],
      publisher: v.publisher || "",
      publishedDate: v.publishedDate || "",
      description: v.description || "",
      pageCount: v.pageCount || null,
      categories: v.categories || [],
      image: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace("http://", "https://"),
      dateAdded: todayISO()
    };
  }

  async function lookupBook(isbn) {
    // Open Library is the primary lookup source so rapid classroom scanning
    // is not dependent on Google's unauthenticated/shared browser quota.
    let openLibraryError = null;

    try {
      const openLibraryBook = await lookupOpenLibrary(isbn);
      if (openLibraryBook) return openLibraryBook;
    } catch (err) {
      openLibraryError = err;
      console.warn("Open Library lookup failed:", err);
    }

    // Google Books remains a useful fallback for ISBNs Open Library does not know.
    try {
      return await lookupGoogleBooks(isbn);
    } catch (err) {
      if (err.status === 429) {
        if (openLibraryError) {
          throw new Error("Both book lookup services are temporarily unavailable. Try the scan again in a moment.");
        }
        throw new Error("This ISBN was not found in Open Library, and the Google Books fallback is temporarily rate-limited.");
      }
      if (openLibraryError) {
        throw new Error("Book lookup is temporarily unavailable. Try again in a moment.");
      }
      throw err;
    }
  }

  function renderLookupPreview(book, already = false) {
    const img = book.image
      ? `<img src="${escapeHTML(book.image)}" alt="">`
      : `<div class="cover-placeholder">NO COVER</div>`;
    $("#bookPreview").innerHTML = `
      <div class="book-preview">
        <div>${img}</div>
        <div>
          <div class="eyebrow">${already ? "ALREADY IN LIBRARY" : "BOOK FOUND"}</div>
          <h3>${escapeHTML(book.title)}</h3>
          <div>${escapeHTML((book.authors || []).join(", ") || "Unknown author")}</div>
          <div class="meta">${escapeHTML(book.isbn)} ${book.pageCount ? ` • ${book.pageCount} pages` : ""}</div>
          ${already ? "" : `<button id="confirmAddBook" class="primary">Add to library</button>`}
        </div>
      </div>
    `;
    if (!already) {
      $("#confirmAddBook").onclick = () => {
        state.books.unshift(book);
        recentIds.unshift(book.id);
        recentIds = recentIds.slice(0, 20);
        save();
        $("#bookPreview").innerHTML = "";
        $("#lookupStatus").textContent = `✓ Added: ${book.title}`;
        $("#scanIsbn").value = "";
        $("#scanIsbn").focus();
        toast("Book added");
      };
    }
  }

  $("#scanBookForm").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#scanIsbn");
    const isbn = normalizeISBN(input.value);
    $("#bookPreview").innerHTML = "";

    if (!isLikelyISBN(isbn)) {
      $("#lookupStatus").textContent = "That doesn't look like a 10- or 13-digit ISBN.";
      input.select();
      return;
    }

    const existing = bookByCode(isbn);
    if (existing) {
      $("#lookupStatus").textContent = "Already in your library.";
      renderLookupPreview(existing, true);
      input.select();
      return;
    }

    $("#lookupStatus").textContent = "Looking up book…";
    try {
      const book = await lookupBook(isbn);
      if (!book) {
        $("#lookupStatus").textContent = "No matching book found. You can add it manually below.";
        return;
      }
      $("#lookupStatus").textContent = "Book found.";
      renderLookupPreview(book);
    } catch (err) {
      $("#lookupStatus").textContent = `Lookup failed: ${err.message}`;
    }
  });

  $("#manualBookForm").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const isbn = normalizeISBN(fd.get("isbn"));
    if (bookByCode(isbn)) {
      toast("That book is already in the library.");
      return;
    }
    const book = {
      id: uid("BOOK"),
      isbn,
      scannedIsbn: isbn,
      googleVolumeId: null,
      title: String(fd.get("title")).trim(),
      subtitle: "",
      authors: String(fd.get("author") || "").split(",").map(x => x.trim()).filter(Boolean),
      publisher: "",
      publishedDate: "",
      description: "",
      pageCount: null,
      categories: String(fd.get("categories") || "").split(",").map(x => x.trim()).filter(Boolean),
      image: "",
      dateAdded: todayISO()
    };
    state.books.unshift(book);
    recentIds.unshift(book.id);
    save();
    e.currentTarget.reset();
    toast("Manual book added");
  });

  $("#studentForm").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("#studentName").value.trim();
    if (!name) return;
    state.students.push({ id: uid("STUDENT"), code: nextStudentCode(), name, active: true, dateAdded: todayISO() });
    $("#studentName").value = "";
    save();
    toast("Student added");
  });

  $("#bulkStudentForm").addEventListener("submit", e => {
    e.preventDefault();
    const names = $("#studentBulk").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    names.forEach(name => {
      state.students.push({ id: uid("STUDENT"), code: nextStudentCode(), name, active: true, dateAdded: todayISO() });
    });
    $("#studentBulk").value = "";
    save();
    toast(`${names.length} student${names.length === 1 ? "" : "s"} added`);
  });

  function deleteStudent(id) {
    const hasOpenLoan = state.loans.some(l => l.studentId === id && !l.returnDate);
    if (hasOpenLoan) {
      toast("Return this student's books before removing them.");
      return;
    }
    const student = state.students.find(s => s.id === id);
    if (!student) return;
    if (!confirm(`Remove ${student.name} from the active roster? Loan history will be kept.`)) return;
    student.active = false;
    save();
  }

  window.deleteStudent = deleteStudent;

  $("#printCardsBtn").addEventListener("click", () => window.print());

  $("#checkoutStudentForm").addEventListener("submit", e => {
    e.preventDefault();
    const student = studentByCode($("#checkoutStudent").value);
    if (!student || !student.active) {
      $("#selectedStudent").className = "selected-box";
      $("#selectedStudent").innerHTML = `<strong>Student card not recognized.</strong>`;
      $("#checkoutStudent").select();
      return;
    }
    selectedStudentId = student.id;
    $("#selectedStudent").className = "selected-box active";
    $("#selectedStudent").innerHTML = `<strong>${escapeHTML(student.name)}</strong><br><span class="muted">${escapeHTML(student.code)}</span>`;
    $("#checkoutBook").disabled = false;
    $("#checkoutBookBtn").disabled = false;
    $("#checkoutBook").focus();
  });

  $("#checkoutBookForm").addEventListener("submit", e => {
    e.preventDefault();
    const student = state.students.find(s => s.id === selectedStudentId);
    const book = bookByCode($("#checkoutBook").value);

    if (!student) {
      $("#checkoutResult").innerHTML = `<div class="result-error">Scan a student first.</div>`;
      return;
    }
    if (!book) {
      $("#checkoutResult").innerHTML = `<div class="result-error">That book is not in the classroom library yet.</div>`;
      $("#checkoutBook").select();
      return;
    }
    const open = currentLoanForBook(book.id);
    if (open) {
      const borrower = state.students.find(s => s.id === open.studentId);
      $("#checkoutResult").innerHTML = `<div class="result-error">${escapeHTML(book.title)} is already checked out${borrower ? ` to ${escapeHTML(borrower.name)}` : ""}.</div>`;
      $("#checkoutBook").select();
      return;
    }

    state.loans.unshift({
      id: uid("LOAN"),
      bookId: book.id,
      studentId: student.id,
      checkoutDate: todayISO(),
      dueDate: addDaysISO(state.settings?.dueDays ?? DEFAULT_DUE_DAYS),
      returnDate: null
    });

    $("#checkoutResult").innerHTML = `<div class="result-success">✓ ${escapeHTML(book.title)} checked out to ${escapeHTML(student.name)}. Due ${fmtDate(state.loans[0].dueDate)}.</div>`;
    $("#checkoutBook").value = "";
    save();
    $("#checkoutBook").focus();
  });

  $("#returnBookForm").addEventListener("submit", e => {
    e.preventDefault();
    const book = bookByCode($("#returnBook").value);
    if (!book) {
      $("#returnResult").innerHTML = `<div class="result-error">That barcode is not in the classroom library.</div>`;
      $("#returnBook").select();
      return;
    }
    const loan = currentLoanForBook(book.id);
    if (!loan) {
      $("#returnResult").innerHTML = `<div class="result-error">${escapeHTML(book.title)} is already marked available.</div>`;
      $("#returnBook").select();
      return;
    }
    loan.returnDate = todayISO();
    const student = state.students.find(s => s.id === loan.studentId);
    $("#returnResult").innerHTML = `<div class="result-success">✓ ${escapeHTML(book.title)} returned${student ? ` by ${escapeHTML(student.name)}` : ""}.</div>`;
    $("#returnBook").value = "";
    save();
    $("#returnBook").focus();
  });

  $$(".mode").forEach(btn => btn.addEventListener("click", () => {
    $$(".mode").forEach(x => x.classList.toggle("active", x === btn));
    const isCheckout = btn.dataset.mode === "checkout";
    $("#checkoutMode").classList.toggle("hidden", !isCheckout);
    $("#returnMode").classList.toggle("hidden", isCheckout);
    setTimeout(() => (isCheckout ? $("#checkoutStudent") : $("#returnBook")).focus(), 50);
  }));

  $("#librarySearch").addEventListener("input", renderLibrary);
  $("#libraryFilter").addEventListener("change", renderLibrary);

  $("#exportBtn").addEventListener("click", () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `classroom-library-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("#importFile").addEventListener("change", async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed.data || parsed;
      if (!incoming.books || !incoming.students || !incoming.loans) throw new Error("Invalid backup.");
      if (!confirm("Replace the data in this browser with this backup?")) return;
      state.books = incoming.books;
      state.students = incoming.students;
      state.loans = incoming.loans;
      state.settings = incoming.settings || { dueDays: DEFAULT_DUE_DAYS };
      save();
      toast("Backup imported");
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    } finally {
      e.target.value = "";
    }
  });

  function renderDashboard() {
    const loans = currentLoans();
    const overdue = loans.filter(l => l.dueDate < todayISO()).length;
    $("#statBooks").textContent = state.books.length;
    $("#statAvailable").textContent = state.books.length - loans.length;
    $("#statChecked").textContent = loans.length;
    $("#statOverdue").textContent = overdue;
    $("#statStudents").textContent = state.students.filter(s => s.active).length;

    $("#dashboardLoans").innerHTML = loans.length ? loanTable(loans, false) : `<div class="empty-state">Nothing is checked out right now.</div>`;
  }

  function loanTable(loans, showReturned = true) {
    const rows = loans.map(l => {
      const book = state.books.find(b => b.id === l.bookId);
      const student = state.students.find(s => s.id === l.studentId);
      const isOverdue = !l.returnDate && l.dueDate < todayISO();
      return `<tr>
        <td>${escapeHTML(book?.title || "Unknown book")}</td>
        <td>${escapeHTML(student?.name || "Former student")}</td>
        <td>${fmtDate(l.checkoutDate)}</td>
        <td class="${isOverdue ? "overdue" : ""}">${fmtDate(l.dueDate)}</td>
        ${showReturned ? `<td>${l.returnDate ? fmtDate(l.returnDate) : "Out"}</td>` : ""}
      </tr>`;
    }).join("");
    return `<table>
      <thead><tr><th>BOOK</th><th>STUDENT</th><th>CHECKED OUT</th><th>DUE</th>${showReturned ? "<th>RETURNED</th>" : ""}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function renderRecent() {
    const books = recentIds.map(id => state.books.find(b => b.id === id)).filter(Boolean);
    $("#sessionCount").textContent = `${books.length} book${books.length === 1 ? "" : "s"}`;
    $("#recentBooks").innerHTML = books.length ? books.map(b => `
      <div class="recent-item">
        <div><strong>${escapeHTML(b.title)}</strong><span class="muted">${escapeHTML((b.authors || []).join(", "))}</span></div>
        <span class="status available">ADDED</span>
      </div>`).join("") : `<div class="empty-state">No books scanned yet.</div>`;
  }

  function renderLibrary() {
    const q = ($("#librarySearch")?.value || "").trim().toLowerCase();
    const filter = $("#libraryFilter")?.value || "all";
    const books = state.books.filter(b => {
      const loan = currentLoanForBook(b.id);
      const hay = `${b.title} ${(b.authors || []).join(" ")} ${b.isbn} ${(b.categories || []).join(" ")}`.toLowerCase();
      const qMatch = !q || hay.includes(q);
      const statusMatch = filter === "all" || (filter === "available" && !loan) || (filter === "checked" && loan);
      return qMatch && statusMatch;
    });

    $("#libraryGrid").innerHTML = books.length ? books.map(b => {
      const loan = currentLoanForBook(b.id);
      const cover = b.image ? `<img class="book-cover" src="${escapeHTML(b.image)}" alt="">` : `<div class="cover-placeholder">NO COVER</div>`;
      return `<article class="book-card">
        <div>${cover}</div>
        <div>
          <h4>${escapeHTML(b.title)}</h4>
          <p>${escapeHTML((b.authors || []).join(", ") || "Unknown author")}</p>
          <p>${escapeHTML(b.isbn)}</p>
          <span class="status ${loan ? "checked" : "available"}">${loan ? "CHECKED OUT" : "AVAILABLE"}</span>
        </div>
      </article>`;
    }).join("") : `<div class="empty-state">No books match that search.</div>`;
  }

  function renderStudents() {
    const active = state.students.filter(s => s.active);
    $("#studentCards").innerHTML = active.length ? active.map(s => `
      <article class="library-card">
        <div class="eyebrow">CLASSROOM LIBRARY CARD</div>
        <h4>${escapeHTML(s.name)}</h4>
        <div class="card-id">${escapeHTML(s.code)}</div>
        <svg class="barcode" data-code="${escapeHTML(s.code)}"></svg>
        <div class="card-actions"><button class="danger-link" onclick="deleteStudent('${s.id}')">Remove</button></div>
      </article>`).join("") : `<div class="empty-state">Add students to create library cards.</div>`;

    if (window.JsBarcode) {
      $$(".barcode").forEach(svg => {
        try {
          JsBarcode(svg, svg.dataset.code, {
            format:"CODE128", displayValue:false, height:42, margin:0, width:1.6
          });
        } catch {}
      });
    }
  }

  function renderHistory() {
    $("#loanHistory").innerHTML = state.loans.length ? loanTable(state.loans.slice(0, 100), true) : `<div class="empty-state">No circulation history yet.</div>`;
  }

  function renderAll() {
    renderDashboard();
    renderRecent();
    renderLibrary();
    renderStudents();
    renderHistory();
  }

  renderAll();
})();