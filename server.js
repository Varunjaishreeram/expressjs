require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const path = require('path');
const nunjucks = require('nunjucks');
const flash = require('connect-flash');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

nunjucks.configure('templates', {
    autoescape: true,
    express: app
});
// Database connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected'))
    .catch(err => console.error('MongoDB connection error:', err));

// Models
const Book = require('./models/book');
const User = require('./models/user');

// Middleware
app.use(bodyParser.json());
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// Passport configuration
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialization: Retrieve user object from the identifier
passport.deserializeUser((id, done) => {
    User.findById(id)
        .then(user => {
            done(null, user);
        })
        .catch(err => {
            done(err, null);
        });
});

app.use((req, res, next) => {
    res.locals.currentUser = req.user; // Make currentUser available in templates
    next();
});

passport.use(new LocalStrategy({
    usernameField: 'identifier', // Use a custom field name to capture both username and email
    passwordField: 'password'
}, async (identifier, password, done) => {
    try {
        // Find user by username or email
        const user = await User.findOne({ $or: [{ username: identifier }, { email: identifier }] });

        // Check if the user exists
        if (!user) {
            // Incorrect username or email
            return done(null, false, { message: 'Incorrect username or password' });
        }

        // Compare the provided password with the hashed password stored in the database
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            // Incorrect password
            return done(null, false, { message: 'Incorrect username or password' });
        }

        // Authentication successful
        return done(null, user);
    } catch (error) {
        return done(error);
    }
}));


app.post('/login', passport.authenticate('local', {

    successRedirect: '/', // Redirect to dashboard upon successful login
    failureRedirect: '/login',     // Redirect back to login page if authentication fails
    failureFlash: true             // Enable flash messages for authentication failures
}));

app.get("/", async (req, res) => {


    try {
        const isLoggedIn = req.isAuthenticated(); // Check if the user is authenticated
        const username = req.user ? req.user.username : ''; // Extract username from req.user
        let successMessage = req.flash('success');
        let errorMessage = req.flash('error');
        const authors = await Book.distinct('author');

        const { publicationYear, author } = req.query;
        let filters = {};

        if (publicationYear) {
            // Extract the year part from the publicationYear field
            const year = parseInt(publicationYear);
            const startDate = new Date(year, 0, 1); // Start of the year
            const endDate = new Date(year, 11, 31); // End of the year
            filters.publicationYear = { $gte: startDate, $lte: endDate };
        }
        if (author) {
            filters.author = author;
        }

        // Query books with applied filters
        const books = await Book.find(filters);

        res.render('home.html', { isLoggedIn, username, successMessage, errorMessage, books, authors });
    } catch (error) {
        errorMessage = error.message; // Display error message if an error occurs
        res.render('home.html', { isLoggedIn, username, successMessage, errorMessage });
    }
});



app.get('/register', (req, res) => {
    const isLoggedIn = req.isAuthenticated(); // Assuming you're using Passport.js for authentication

    res.render('register.html', { isLoggedIn });

});



app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required" });
    }

    try {
        // Generate a salt for password hashing
        const salt = await bcrypt.genSalt(10);

        // Hash the password using the generated salt
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create a new user with the hashed password
        const newUser = new User({ username, email, password: hashedPassword });

        // Save the new user to the database
        const user = await newUser.save();
        req.flash('success', 'Registration successful! You can now log in to your account.');
        // Redirect to the login page after successful registration
        res.redirect('/');
    } catch (err) {
        console.error("User registration failed:", err);
        return res.status(500).json({ error: err.message });
    }
});


function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        res.redirect('/'); // Redirect if authenticated
    } else {
        next(); // Call next() only if not authenticated
    }
}

function ensureAuthenticatedbook(req, res, next) {
    if (req.isAuthenticated()) {
        next(); // Redirect if authenticated
    } else {
        req.flash('error', 'please login to just upload');
        res.redirect("/login"); // Call next() only if not authenticated
    }
}

app.get('/login', ensureAuthenticated, (req, res) => {
    // Render login form with flash messages
    const isLoggedIn = req.isAuthenticated();

    res.render('login.html', { errorMessage: req.flash('error'), isLoggedIn });
});


app.get('/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            console.error('Error logging out:', err);
            return res.status(500).json({ error: 'Error logging out' });
        }
        res.redirect('/login'); // Redirect the user to the login page after logout
    });
});



app.post('/books/upload', ensureAuthenticatedbook, async (req, res) => {
    try {
        const { title, author, publicationYear, description } = req.body;
        const newBook = new Book({ title, author, publicationYear, description, user: req.user._id });
        const savedBook = await newBook.save();
        // Set a flash message indicating successful book upload
        req.flash('success', 'Book uploaded successfully');
        // Redirect to the home page
        res.redirect('/');
    } catch (error) {
        console.error('Error creating book:', error);
        req.flash('error', error);
        res.redirect('/');
    }
});


app.get('/books/:id', async (req, res) => {
    try {
        const bookId = req.params.id;
        const book = await Book.findById(bookId);

        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }


        res.render('book_details.html', { book, currentUser: req.user });
    } catch (error) {
        console.error('Error fetching book details:', error);
        res.status(500).json({ error: 'Failed to fetch book details' });
    }
});


app.get('/books/:id/edit', async (req, res) => {
    try {
        const bookId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(bookId)) {
            req.flash('error', 'Invalid book ID');
            return res.redirect("/");
        }
        const book = await Book.findById(bookId);



        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect("/");
        }

        if (!req.isAuthenticated() || book.user.toString() !== req.user._id.toString()) {
            req.flash('error', 'Access denied');
            return res.redirect("/");
        }

        res.render('edit_book.html', { book });
    } catch (error) {
        console.error('Error fetching book details:', error);
        res.status(500).json({ error: 'Failed to fetch book details' });
    }
});


app.post('/books/:id/edit', async (req, res) => {
    try {
        const bookId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(bookId)) {
            req.flash('error', 'Invalid book ID');
            return res.redirect("/");
        }

        const book = await Book.findById(bookId);

        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect("/");
        }

        if (!req.isAuthenticated() || book.user.toString() !== req.user._id.toString()) {
            req.flash('error', 'Access denied');
            return res.redirect("/");
        }


        // Update the book details
        const { title, author, publicationYear, description } = req.body;
        book.title = title;
        book.author = author;
        book.publicationYear = publicationYear;
        book.description = description
        await book.save();

        req.flash('success', 'Book details updated successfully');
        res.redirect(`/books/${book._id}`);

    } catch (error) {
        console.error('Error updating book:', error);
        req.flash('error', 'Failed to update book details');
        res.redirect("/");
    }
});



app.get('/addbook', (req, res) => {
    const isLoggedIn = req.isAuthenticated();
    res.render('upload.html', { isLoggedIn });
});


app.get('/my-books', async (req, res) => {
    try {
        if (!req.isAuthenticated()) {
            req.flash('error', 'Please login first to browse');
            return res.redirect("/");
        }

        // Get the ID of the authenticated user
        const userId = req.user._id;

        // Find all books uploaded by the authenticated user
        const books = await Book.find({ user: userId });

        // Render a template to display the user's collection of books
        res.render('my_books.html', { books });
    } catch (error) {
        console.error('Error fetching user books:', error);
        req.flash('error', 'Failed to fetch user books');
        res.redirect("/");
    }
});








app.post('/books/:id/delete', async (req, res) => {
    try {
        const bookId = req.params.id;

        if (!mongoose.Types.ObjectId.isValid(bookId)) {
            req.flash('error', 'Invalid book ID');
            return res.redirect("/");
        }

        const book = await Book.findById(bookId);

        if (!book) {
            req.flash('error', 'Book not found');
            return res.redirect("/");
        }

        if (!req.isAuthenticated() || book.user.toString() !== req.user._id.toString()) {
            req.flash('error', 'Access denied');
            return res.redirect("/");
        }

        // Delete the book
        await Book.deleteOne({ _id: bookId });

        req.flash('success', 'Book deleted successfully');
        res.redirect("/");

    } catch (error) {
        console.error('Error deleting book:', error);
        req.flash('error', 'Failed to delete book');
        res.redirect("/");
    }
});







// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
