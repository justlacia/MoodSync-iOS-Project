-- MoodSync Enterprise SQL Server Schema (Upgraded & Backwards-Compatible)
-- Run inside your target SQL Server database (e.g., MoodSync).
-- Preserves existing MoodSyncAccounts & MoodSyncHistory compatibility while adding
-- Username login, rich online-synced Tracks, Genres, ScanSessionPlaylists, Favorites, and Preferences.

SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- 1. Accounts (supports both classic Username login and Email login)
IF OBJECT_ID('dbo.MoodSyncAccounts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncAccounts (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Username NVARCHAR(64) NOT NULL UNIQUE,
        DisplayName NVARCHAR(100) NOT NULL,
        Email NVARCHAR(254) NULL,
        PasswordHash VARCHAR(200) NOT NULL,
        PreferredRegion VARCHAR(10) NOT NULL DEFAULT 'all' CHECK (PreferredRegion IN ('all', 'tr', 'global')),
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        LastLoginAt DATETIME2 NULL
    );
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.MoodSyncAccounts', 'Username') IS NULL
    BEGIN
        ALTER TABLE dbo.MoodSyncAccounts ADD Username NVARCHAR(64) NULL;
        EXEC('UPDATE dbo.MoodSyncAccounts SET Username = LEFT(Email, CHARINDEX(''@'', Email + ''@'') - 1) + ''_'' + CAST(Id AS NVARCHAR(10)) WHERE Username IS NULL');
        ALTER TABLE dbo.MoodSyncAccounts ALTER COLUMN Username NVARCHAR(64) NOT NULL;
        CREATE UNIQUE INDEX IX_MoodSyncAccounts_Username ON dbo.MoodSyncAccounts(Username);
    END;
    IF COL_LENGTH('dbo.MoodSyncAccounts', 'PreferredRegion') IS NULL
        ALTER TABLE dbo.MoodSyncAccounts ADD PreferredRegion VARCHAR(10) NOT NULL DEFAULT 'all';
    IF COL_LENGTH('dbo.MoodSyncAccounts', 'LastLoginAt') IS NULL
        ALTER TABLE dbo.MoodSyncAccounts ADD LastLoginAt DATETIME2 NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MoodSyncAccounts_Email_Filtered' AND object_id = OBJECT_ID('dbo.MoodSyncAccounts'))
    CREATE UNIQUE INDEX IX_MoodSyncAccounts_Email_Filtered ON dbo.MoodSyncAccounts(Email) WHERE Email IS NOT NULL;

-- 2. Music Genres
IF OBJECT_ID('dbo.MoodSyncGenres', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncGenres (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        Slug VARCHAR(40) NOT NULL UNIQUE,
        NameTr NVARCHAR(80) NOT NULL,
        DefaultMood VARCHAR(10) NOT NULL CHECK (DefaultMood IN ('positive', 'neutral', 'negative'))
    );
END;

-- 3. Rich Online-Synced Music Catalog
IF OBJECT_ID('dbo.MoodSyncTracks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncTracks (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        ExternalSource VARCHAR(20) NOT NULL DEFAULT 'itunes',
        ExternalId VARCHAR(80) NOT NULL,
        Title NVARCHAR(200) NOT NULL,
        Artist NVARCHAR(160) NOT NULL,
        Album NVARCHAR(200) NOT NULL DEFAULT '',
        Genre NVARCHAR(80) NOT NULL DEFAULT 'Pop',
        Mood VARCHAR(10) NOT NULL CHECK (Mood IN ('positive', 'neutral', 'negative')),
        EnergyTag VARCHAR(30) NOT NULL DEFAULT 'balanced',
        Language VARCHAR(10) NOT NULL DEFAULT 'global' CHECK (Language IN ('tr', 'global')),
        ArtworkUrl NVARCHAR(500) NOT NULL DEFAULT '',
        PreviewUrl NVARCHAR(500) NOT NULL DEFAULT '',
        StoreUrl NVARCHAR(500) NOT NULL DEFAULT '',
        YoutubeUrl NVARCHAR(500) NOT NULL DEFAULT '',
        DurationMs INT NOT NULL DEFAULT 0,
        ReleaseYear INT NULL,
        Popularity INT NOT NULL DEFAULT 50,
        PlayCount INT NOT NULL DEFAULT 0,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_MoodSyncTracks_SourceId UNIQUE (ExternalSource, ExternalId)
    );
    CREATE INDEX IX_MoodSyncTracks_Mood_Language ON dbo.MoodSyncTracks(Mood, Language, Popularity DESC);
    CREATE INDEX IX_MoodSyncTracks_Genre ON dbo.MoodSyncTracks(Genre);
END;

-- 4. Scan Sessions / History (Upgraded with Capture Metadata & Snapshot)
IF OBJECT_ID('dbo.MoodSyncHistory', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncHistory (
        Id INT IDENTITY(1,1) PRIMARY KEY,
        AccountId INT NOT NULL REFERENCES dbo.MoodSyncAccounts(Id) ON DELETE CASCADE,
        Mood VARCHAR(10) NOT NULL CHECK (Mood IN ('positive', 'negative', 'neutral')),
        Confidence FLOAT NOT NULL CHECK (Confidence BETWEEN 0 AND 1),
        ScoresJson NVARCHAR(400) NOT NULL DEFAULT '{}',
        SnapshotDataUrl NVARCHAR(MAX) NULL,
        CaptureSource VARCHAR(20) NOT NULL DEFAULT 'camera',
        DeviceLabel NVARCHAR(80) NOT NULL DEFAULT 'Kamera',
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_MoodSyncHistory_AccountDate ON dbo.MoodSyncHistory(AccountId, CreatedAt DESC);
END
ELSE
BEGIN
    IF COL_LENGTH('dbo.MoodSyncHistory', 'ScoresJson') IS NULL
        ALTER TABLE dbo.MoodSyncHistory ADD ScoresJson NVARCHAR(400) NOT NULL DEFAULT '{}';
    IF COL_LENGTH('dbo.MoodSyncHistory', 'SnapshotDataUrl') IS NULL
        ALTER TABLE dbo.MoodSyncHistory ADD SnapshotDataUrl NVARCHAR(MAX) NULL;
    IF COL_LENGTH('dbo.MoodSyncHistory', 'CaptureSource') IS NULL
        ALTER TABLE dbo.MoodSyncHistory ADD CaptureSource VARCHAR(20) NOT NULL DEFAULT 'camera';
    IF COL_LENGTH('dbo.MoodSyncHistory', 'DeviceLabel') IS NULL
        ALTER TABLE dbo.MoodSyncHistory ADD DeviceLabel NVARCHAR(80) NOT NULL DEFAULT 'Kamera';
END;

-- 5. Session Recommended Tracks (Links each scan session to its exact generated playlist)
IF OBJECT_ID('dbo.MoodSyncSessionTracks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncSessionTracks (
        SessionId INT NOT NULL REFERENCES dbo.MoodSyncHistory(Id) ON DELETE CASCADE,
        TrackId INT NOT NULL REFERENCES dbo.MoodSyncTracks(Id) ON DELETE CASCADE,
        Position INT NOT NULL DEFAULT 0,
        PRIMARY KEY (SessionId, TrackId)
    );
    CREATE INDEX IX_MoodSyncSessionTracks_Order ON dbo.MoodSyncSessionTracks(SessionId, Position ASC);
END;

-- 6. User Favorite Tracks
IF OBJECT_ID('dbo.MoodSyncFavorites', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncFavorites (
        AccountId INT NOT NULL REFERENCES dbo.MoodSyncAccounts(Id) ON DELETE CASCADE,
        TrackId INT NOT NULL REFERENCES dbo.MoodSyncTracks(Id) ON DELETE CASCADE,
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        PRIMARY KEY (AccountId, TrackId)
    );
END;

-- 7. Adaptive Genre Preferences
IF OBJECT_ID('dbo.MoodSyncPreferences', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MoodSyncPreferences (
        AccountId INT NOT NULL REFERENCES dbo.MoodSyncAccounts(Id) ON DELETE CASCADE,
        Genre NVARCHAR(80) NOT NULL,
        Mood VARCHAR(10) NOT NULL CHECK (Mood IN ('positive', 'neutral', 'negative')),
        Weight FLOAT NOT NULL DEFAULT 1.0,
        UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        PRIMARY KEY (AccountId, Genre, Mood)
    );
END;

COMMIT;
